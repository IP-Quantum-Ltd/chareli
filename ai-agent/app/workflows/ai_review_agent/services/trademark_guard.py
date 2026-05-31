"""
trademark_guard.py
==================
Purely deterministic trademark and hallucination guard.

Zero LLM calls.  Applied at two points in the pipeline:
  1. content_auditor_service.py — flags violations during draft review.
  2. submission_reconciler.py  — final redaction pass before DB write.

Design principles
-----------------
- The blocklist is a frozenset for O(1) lookup.
- Redaction replaces the matched term with a genre-appropriate generic phrase
  to preserve readability rather than leaving a blank gap.
- Word-boundary matching prevents false positives (e.g. "mine" inside "Minecraft").
- Case-insensitive matching with case-preserving replacement is not needed here
  since the blocklist contains the canonical spellings; all replacements are
  generic descriptors so casing is irrelevant.
"""

from __future__ import annotations

import re
from typing import Dict, FrozenSet, List, Tuple


# ---------------------------------------------------------------------------
# Trademark blocklist
# ---------------------------------------------------------------------------
# Add entries as needed.  Use the most common/canonical spelling.
# Matching is case-insensitive and word-boundary anchored.

TRADEMARK_BLOCKLIST: FrozenSet[str] = frozenset(
    [
        # Major game franchises / brand names
        "Pac-Man",
        "Pacman",
        "Pac Man",
        "Minecraft",
        "Roblox",
        "Fortnite",
        "Among Us",
        "Tetris",
        "Mario",
        "Super Mario",
        "Luigi",
        "Donkey Kong",
        "Zelda",
        "Link",
        "Pokemon",
        "Pokémon",
        "Pikachu",
        "Sonic",
        "Sonic the Hedgehog",
        "Crash Bandicoot",
        "Spyro",
        "Kirby",
        "Metroid",
        "Samus",
        "Mega Man",
        "Street Fighter",
        "Mortal Kombat",
        "Call of Duty",
        "Grand Theft Auto",
        "GTA",
        "FIFA",
        "NBA 2K",
        "Madden",
        "Overwatch",
        "League of Legends",
        "Dota 2",
        "Counter-Strike",
        "CSGO",
        "CS:GO",
        "Valorant",
        "Apex Legends",
        "Warcraft",
        "Hearthstone",
        "Diablo",
        "Starcraft",
        "World of Warcraft",
        "WoW",
        "Candy Crush",
        "Angry Birds",
        "Clash of Clans",
        "Clash Royale",
        "Subway Surfers",
        "Temple Run",
        "Crossy Road",
        "Flappy Bird",
        "Cut the Rope",
        "Plants vs Zombies",
        "Plants vs. Zombies",
        "Fruit Ninja",
        "Jetpack Joyride",
        "Geometry Dash",
        "Cuphead",
        "Hollow Knight",
        "Celeste",
        "Undertale",
        "Stardew Valley",
        "Terraria",
        "Subnautica",
        "PUBG",
        "Battlegrounds",
        "Rust",
        "ARK",
        "Elden Ring",
        "Dark Souls",
        "Bloodborne",
        "Sekiro",
        "God of War",
        "Spider-Man",
        "Batman",
        "Superman",
        "Iron Man",
        "Captain America",
        "Thor",
        "Avengers",
        # Platform / publisher brands
        "Nintendo",
        "PlayStation",
        "Xbox",
        "Sega",
        "Atari",
        "Bandai Namco",
        "Capcom",
        "Konami",
        "Square Enix",
        "Activision",
        "Blizzard",
        "Electronic Arts",
        "EA Sports",
        "Ubisoft",
        "Rockstar",
        "Epic Games",
        "Unity",
        "Unreal Engine",
        "Steam",
        "Google Play",
        "App Store",
    ]
)

# Generic replacement phrases by category (used for redaction)
_GENERIC_GAME_DESCRIPTOR = "a classic arcade game"
_GENERIC_CHARACTER = "the main character"
_GENERIC_FRANCHISE = "a popular game series"

# Map specific blocklist terms to better generic replacements
_SPECIFIC_REPLACEMENTS: Dict[str, str] = {
    "mario": "the main character",
    "luigi": "the second player character",
    "pikachu": "the main character",
    "sonic": "the speedy protagonist",
    "link": "the hero",
    "samus": "the bounty hunter protagonist",
    "pac-man": "the classic dot-eating hero",
    "pacman": "the classic dot-eating hero",
    "pac man": "the classic dot-eating hero",
    "tetris": "the classic block-stacking puzzle game",
    "minecraft": "the popular sandbox game",
    "roblox": "the popular user-generated platform",
    "fortnite": "the popular battle royale game",
    "among us": "the popular social deduction game",
}


# ---------------------------------------------------------------------------
# Pre-compiled regex patterns (built once at import time)
# ---------------------------------------------------------------------------

def _build_patterns(blocklist: FrozenSet[str]) -> List[Tuple[re.Pattern[str], str]]:
    """Return list of (compiled_pattern, replacement) tuples."""
    patterns: List[Tuple[re.Pattern[str], str]] = []
    # Sort longest first so multi-word phrases are matched before sub-terms
    for term in sorted(blocklist, key=len, reverse=True):
        escaped = re.escape(term)
        pattern = re.compile(rf"\b{escaped}\b", re.IGNORECASE)
        replacement = _SPECIFIC_REPLACEMENTS.get(term.lower(), _GENERIC_GAME_DESCRIPTOR)
        patterns.append((pattern, replacement))
    return patterns


_PATTERNS: List[Tuple[re.Pattern[str], str]] = _build_patterns(TRADEMARK_BLOCKLIST)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scan_for_trademarks(text: str) -> List[str]:
    """
    Return a list of matched blocklist terms found in ``text``.

    Case-insensitive, word-boundary anchored.  Returns at most one entry
    per distinct term (deduped).

    Parameters
    ----------
    text : str
        Plain text or HTML string to scan.

    Returns
    -------
    List[str]
        Matched trademark strings (original blocklist spelling).
    """
    if not text:
        return []
    # Strip HTML tags before scanning so we don't hit tag attributes
    plain = re.sub(r"<[^>]+>", " ", text)
    found: List[str] = []
    seen: set[str] = set()
    for term in sorted(TRADEMARK_BLOCKLIST, key=len, reverse=True):
        key = term.lower()
        if key in seen:
            continue
        escaped = re.escape(term)
        if re.search(rf"\b{escaped}\b", plain, re.IGNORECASE):
            found.append(term)
            seen.add(key)
    return found


def redact_trademarks(text: str) -> str:
    """
    Replace all blocklisted trademark terms in ``text`` with generic
    descriptors, preserving surrounding HTML structure.

    Applies multi-word patterns first (longest match first) to avoid
    partial replacements.

    Parameters
    ----------
    text : str
        HTML or plain text to sanitise.

    Returns
    -------
    str
        Sanitised text with trademarks replaced.
    """
    if not text:
        return text
    result = text
    for pattern, replacement in _PATTERNS:
        result = pattern.sub(replacement, result)
    return result


def has_trademark_violations(text: str) -> bool:
    """Quick boolean check — True if any blocklisted term is present."""
    return bool(scan_for_trademarks(text))
