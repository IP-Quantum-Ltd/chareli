"""
proposal_structure.py
=====================
Single source of truth for the canonical 5-section game-proposal structure.

Every service in the pipeline imports from here — no hardcoded section titles
in prompts or node logic.

Field mapping (verified against Client/src/components/single/GameInfoSection.tsx):
  description        ← Overview section HTML only
  metadata.howToPlay ← How to Play + Controls + Strategy sections (concatenated)
  metadata.faqOverride ← FAQ section, formatted as <h3>+<h4>Q:…</h4><p>A:…</p>
"""

from __future__ import annotations

import html
import re
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Canonical section order (immutable)
# ---------------------------------------------------------------------------

CANONICAL_SECTIONS: List[str] = [
    "Overview",
    "How to Play",
    "Controls",
    "Strategy",
    "FAQ",
]

# Which DB fields each section feeds into:
#   description   → Overview
#   howToPlay     → How to Play + Controls + Strategy (merged)
#   faqOverride   → FAQ
DESCRIPTION_SECTIONS: List[str] = ["Overview"]
HOW_TO_PLAY_SECTIONS: List[str] = ["How to Play", "Controls", "Strategy"]
FAQ_SECTIONS: List[str] = ["FAQ"]


# ---------------------------------------------------------------------------
# Per-section writing goals (injected into architect & scribe prompts)
# ---------------------------------------------------------------------------

SECTION_GOALS: Dict[str, List[str]] = {
    "Overview": [
        "Introduce the game's core concept and appeal in 2–4 paragraphs.",
        "Describe the game genre, setting, and main objective without repeating controls or strategy.",
        "Hook the reader — highlight what makes this game unique on ArcadeBox.",
        "Do NOT mention how to play, specific controls, or tips — those belong in later sections.",
    ],
    "How to Play": [
        "Explain the moment-to-moment gameplay loop clearly for a first-time player.",
        "Cover game modes, rounds, lives, scoring system, or win/lose conditions.",
        "Do NOT list keyboard/mouse/touch controls here — those belong in Controls.",
        "Do NOT give advanced tips or meta-strategy — those belong in Strategy.",
    ],
    "Controls": [
        "List all input controls clearly: keyboard, mouse, touch/swipe for mobile.",
        "Use a structured format (e.g. bullet list per input device).",
        "Do NOT restate how the game works — only the controls.",
        "Separate PC controls from mobile/touch controls explicitly.",
    ],
    "Strategy": [
        "Provide 3–6 actionable tips or tactics that improve performance.",
        "Base every tip on verified game mechanics — do not invent mechanics.",
        "Do NOT repeat controls or basic how-to-play information.",
        "Focus on progression, prioritisation, timing, and common mistakes to avoid.",
    ],
    "FAQ": [
        "Write 5–8 questions a real player would search AFTER reading the above sections.",
        "Questions must NOT repeat or rephrase content already covered in Overview, How to Play, Controls, or Strategy.",
        "Answers must be concise (1–3 sentences) and grounded in verified facts.",
        "Include questions about: platform availability, saving progress, difficulty, platform controls, unblocked access.",
        "Format: <h3>[Game Name] FAQ</h3> then for each item: <h4>Q: [question]</h4><p>[answer]</p>",
        "Never invent facts or lie about unsupported mechanics. Focus only on verified details directly relevant to this specific game.",
        "CRITICAL: Never claim the game is 'completely free', '100% free', or 'without any cost barriers'. If asked about cost or registration, state that standard ArcadeBox session limits or demo policies apply.",
    ],
}

# Configurable minimum content signals per section (used by auditor fallback)
SECTION_MIN_CHARS: Dict[str, int] = {
    "Overview": 200,
    "How to Play": 150,
    "Controls": 80,
    "Strategy": 150,
    "FAQ": 100,  # checked per-item below
}
FAQ_MIN_ITEMS: int = 3


# ---------------------------------------------------------------------------
# ArticleSectionExtractor
# ---------------------------------------------------------------------------

class ArticleSectionExtractor:
    """
    Deterministic HTML section extractor.

    Parses a structured HTML article produced by the scribe and extracts
    named sections by their <h2> heading text.  No LLM call, no external
    dependencies (no BeautifulSoup).

    Usage
    -----
    extractor = ArticleSectionExtractor(article_html)
    overview_html  = extractor.get_section("Overview")
    combined_htp   = extractor.get_sections(["How to Play", "Controls", "Strategy"])
    faq_html       = extractor.get_faq_section()   # reformatted for faqTemplate.ts
    """

    # Matches <h2> tags with optional attributes, capturing the inner text
    _H2_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.IGNORECASE | re.DOTALL)

    def __init__(self, article_html: str) -> None:
        self._html = article_html or ""
        self._sections: Dict[str, str] = {}
        self._parse()

    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def _parse(self) -> None:
        """Split the article HTML into named sections by <h2> headings."""
        splits: List[Tuple[str, int]] = []  # (heading_text, start_pos_of_h2_tag)

        for match in self._H2_RE.finditer(self._html):
            heading_text = re.sub(r"<[^>]+>", "", match.group(1)).strip()
            splits.append((heading_text, match.start()))

        for i, (heading, start) in enumerate(splits):
            # Content runs from right after the <h2>…</h2> tag to the start
            # of the next <h2> (or end of document)
            h2_end = self._H2_RE.search(self._html, start).end()
            content_end = splits[i + 1][1] if i + 1 < len(splits) else len(self._html)
            section_html = self._html[start:content_end].strip()
            # Normalise heading name for lookup
            key = self._normalise(heading)
            self._sections[key] = section_html

    @staticmethod
    def _normalise(text: str) -> str:
        return re.sub(r"\s+", " ", text.strip()).lower()

    # ------------------------------------------------------------------
    # Public accessors
    # ------------------------------------------------------------------

    def section_names(self) -> List[str]:
        """Return detected heading names (original casing not preserved)."""
        return list(self._sections.keys())

    def has_section(self, name: str) -> bool:
        return self._normalise(name) in self._sections

    def missing_sections(self, required: Optional[List[str]] = None) -> List[str]:
        """Return canonical section names that are absent from the article."""
        required = required or CANONICAL_SECTIONS
        return [s for s in required if not self.has_section(s)]

    def get_section(self, name: str) -> str:
        """Return the HTML block for a single named section (empty string if absent)."""
        return self._sections.get(self._normalise(name), "")

    def get_sections(self, names: List[str]) -> str:
        """Return concatenated HTML for multiple named sections."""
        parts = [self.get_section(name) for name in names]
        return "\n".join(p for p in parts if p)

    def get_description_html(self) -> str:
        """Overview section → game.description field."""
        return self.get_sections(DESCRIPTION_SECTIONS)

    def get_how_to_play_html(self) -> str:
        """How to Play + Controls + Strategy → metadata.howToPlay field."""
        return self.get_sections(HOW_TO_PLAY_SECTIONS)

    def get_faq_section(self) -> str:
        """
        FAQ section → metadata.faqOverride field.

        Reformats the raw FAQ HTML to match the structure expected by the
        client's faqTemplate.ts parseFAQ() function:

            <h3>[Game Name] FAQ</h3>
            <h4>Q: question text</h4>
            <p>answer text</p>
            ...

        parseFAQ() scans for <h4> elements as question headings and the
        following <p> elements as answers.  Any other tag structure will
        be silently ignored by the client parser.
        """
        raw = self.get_section("FAQ")
        if not raw:
            return ""
        return _reformat_faq_html(raw)

    def detect_cross_section_duplicates(self) -> List[str]:
        """
        Lightweight cross-section duplicate detector.

        Returns a list of sentence-level phrases (≥6 words) that appear
        verbatim in more than one section.  Used by the auditor fallback.
        """
        duplicates: List[str] = []
        section_texts: Dict[str, List[str]] = {}
        for name in CANONICAL_SECTIONS:
            raw_html = self.get_section(name)
            # Replace common block/heading closing tags with a period/space to prevent sentence merging
            temp_html = re.sub(r"</(h[1-6]|p|li|div|ul|ol)>", ". ", raw_html, flags=re.IGNORECASE)
            plain = re.sub(r"<[^>]+>", " ", temp_html)
            sentences = [
                s.strip() for s in re.split(r"[.!?]+", plain) if len(s.split()) >= 6
            ]
            section_texts[name] = [s.lower() for s in sentences]

        seen: Dict[str, str] = {}  # sentence → first_section
        for section_name, sentences in section_texts.items():
            for sentence in sentences:
                if sentence in seen and seen[sentence] != section_name:
                    duplicates.append(
                        f"'{sentence[:80]}…' appears in both '{seen[sentence]}' and '{section_name}'"
                    )
                else:
                    seen[sentence] = section_name
        return duplicates


# ---------------------------------------------------------------------------
# FAQ HTML reformatter
# ---------------------------------------------------------------------------

def _reformat_faq_html(raw_faq_html: str) -> str:
    """
    Take the FAQ section as written by the scribe (arbitrary heading levels)
    and reformat it into the exact structure parseFAQ() in faqTemplate.ts
    expects:

        <h3>[Game Name] FAQ</h3>
        <h4>Q: question</h4>
        <p>answer</p>

    Strategy:
    1. Extract the section title (first heading found).
    2. For every question/answer pair — found as any heading (h2–h5) followed
       by <p> content — emit the canonical <h4>Q:</h4><p></p> pattern.
    3. If the heading already starts with "Q:" keep it; otherwise prepend it.
    """
    # Extract section title (first heading tag of any level)
    title_match = re.search(r"<h[2-6][^>]*>(.*?)</h[2-6]>", raw_faq_html, re.IGNORECASE | re.DOTALL)
    title_text = ""
    if title_match:
        title_text = re.sub(r"<[^>]+>", "", title_match.group(1)).strip()
        if not title_text.lower().startswith("faq"):
            title_text = f"FAQ"
    else:
        title_text = "FAQ"

    # Find all question/answer pairs:  heading followed by one or more <p>
    qa_pattern = re.compile(
        r"<h[3-6][^>]*>(.*?)</h[3-6]>(.*?)(?=<h[2-6]|$)",
        re.IGNORECASE | re.DOTALL,
    )
    chunks: List[str] = [f"<h3>{html.escape(title_text)}</h3>"]
    for match in qa_pattern.finditer(raw_faq_html):
        question_raw = re.sub(r"<[^>]+>", "", match.group(1)).strip()
        answer_block = match.group(2).strip()

        # Normalise question prefix
        question_text = re.sub(r"^Q:\s*", "", question_raw, flags=re.IGNORECASE).strip()
        if not question_text or len(question_text) < 5:
            continue

        # Collect <p> answer text
        p_matches = re.findall(r"<p[^>]*>(.*?)</p>", answer_block, re.IGNORECASE | re.DOTALL)
        answer_text = " ".join(
            re.sub(r"<[^>]+>", "", p).strip() for p in p_matches
        ).strip()
        if not answer_text:
            # Fall back: strip all tags from the block
            answer_text = re.sub(r"<[^>]+>", " ", answer_block).strip()
        if not answer_text:
            continue

        chunks.append(
            f"<h4>Q: {html.escape(question_text)}</h4>"
            f"<p>{html.escape(answer_text)}</p>"
        )

    return "\n".join(chunks) if len(chunks) > 1 else ""
