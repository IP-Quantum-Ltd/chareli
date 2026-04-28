import logging
import os
import base64
from dotenv import load_dotenv

# Ensure environment is loaded before any tracing/graph imports
load_dotenv()
from typing import TypedDict, Dict, Any, List, Optional
from langgraph.graph import StateGraph, END
from langsmith import traceable
from app.config import settings

from app.services.browser_agent import capture_game_preview
from app.services.visual_librarian import VisualLibrarian
from app.services.analyst_agent import AnalystAgent
from app.services.librarian_agent import LibrarianAgent
from app.services.architect_agent import ArchitectAgent
from app.services.scribe_agent import ScribeAgent

logger = logging.getLogger(__name__)

class AgentState(TypedDict):
    """The state object passed between nodes in LangGraph."""
    game_id: str
    game_title: str
    internal_capture_metadata: Dict[str, Any]
    internal_imgs_base64: List[str]  # [thumbnail, gameplay_start]
    internal_imgs_paths: List[str]
    investigation: Dict[str, Any]
    seo_blueprint: Dict[str, Any]
    grounded_context: Dict[str, Any]
    outline: Dict[str, Any]
    article: str
    accumulated_cost: float
    status: str
    report_path: Optional[str]
    max_candidates: int
    error_message: Optional[str]

# --- Node Implementations ---

async def capture_node(state: AgentState) -> AgentState:
    logger.info(f"Node: Capture | Game ID: {state['game_id']}")
    
    try:
        # The new browser agent handles multi-point capture
        capture_result = await capture_game_preview(
            game_id=state["game_id"],
            output_path=f"internal_{state['game_id']}.png"
        )
        
        # If capture_result is a string (legacy/single path), wrap it
        if isinstance(capture_result, str):
            paths = [capture_result]
        else:
            # New branch returns a dict with 'paths'
            paths = capture_result.get("paths", [capture_result]) if isinstance(capture_result, dict) else [capture_result]

        state["internal_imgs_paths"] = paths
        state["status"] = "captured"
        
        # Encode for multi-modal vision
        state["internal_imgs_base64"] = []
        for p in paths:
            if os.path.exists(p):
                with open(p, "rb") as f:
                    state["internal_imgs_base64"].append(base64.b64encode(f.read()).decode("utf-8"))
        
    except Exception as e:
        logger.error(f"Capture Integrity Failed: {e}")
        state["status"] = "failed"
        state["error_message"] = f"CRITICAL: Internal capture failed. Detail: {e}"
        
    return state

async def research_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Visual Research (Stage 0)")
    
    librarian = VisualLibrarian()
    # Support multiple screenshots for correlation
    result = await librarian.verify_and_research(
        game_id=state["game_id"],
        game_title=state["game_title"], 
        internal_screenshots=state["internal_imgs_base64"],
        max_candidates=state.get("max_candidates", settings.LIBRARIAN_MAX_CANDIDATES)
    )
    
    state["accumulated_cost"] += librarian.last_cost
    state["investigation"] = result
    
    if result["status"] == "failed":
        state["status"] = "failed"
        state["error_message"] = f"Visual correlation failed: {result['reason']}"
    else:
        state["status"] = "researched"
        
    return state

async def analyze_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: SEO Intelligence (Stage 1)")
    
    analyst = AnalystAgent()
    # In tweaks branch, analyst takes the whole investigation
    blueprint = await analyst.analyze_seo_potential(
        state["game_title"], 
        state["investigation"].get("best_match", {}).get("extracted_facts", {})
    )
    state["accumulated_cost"] += analyst.last_cost
    state["seo_blueprint"] = blueprint
    state["status"] = "analyzed"
    return state

async def librarian_node(state: AgentState) -> AgentState:
    """Stage 2: Grounding search results with LibrarianAgent."""
    if state["status"] == "failed": return state
    logger.info("Node: Librarian (Stage 2)")

    try:
        librarian = LibrarianAgent()
        grounded_context = await librarian.build_grounded_context(
            state["game_title"],
            state["investigation"],
            state["seo_blueprint"],
        )
        state["accumulated_cost"] += librarian.last_cost
        state["grounded_context"] = grounded_context.get("grounded_packet", {})
        state["status"] = "grounded"
    except Exception as e:
        logger.error(f"Librarian Stage Failed: {e}")
        state["status"] = "failed"
        state["error_message"] = f"Stage 2 grounding failed: {e}"
    return state

async def architect_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Architect (Stage 3)")
    
    architect = ArchitectAgent()
    outline = await architect.build_outline(state["game_title"], {
        "grounded_context": state.get("grounded_context", {}),
    })
    state["accumulated_cost"] += architect.last_cost
    state["outline"] = outline
    state["status"] = "architected"
    return state

async def scribe_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Scribe (Stage 5)")
    
    scribe = ScribeAgent()
    best_match = state["investigation"]["best_match"]
    article = await scribe.draft_from_facts(state["game_title"], {
        "source_url": best_match["url"],
        "facts": best_match.get("extracted_facts") or {},
        "seo": {
            "primary_keywords": state["seo_blueprint"].get("primary_keywords", []),
            "secondary_keywords": state["seo_blueprint"].get("secondary_keywords", []),
            "content_angles": state["seo_blueprint"].get("content_angles", []),
        },
        "grounded_context": state.get("grounded_context", {}),
        "content_plan": state.get("outline", ""),
    })
    state["accumulated_cost"] += scribe.last_cost
    state["article"] = article
    state["status"] = "complete"
    return state

async def reporter_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Reporter (Final Audit & Article)")
    
    from app.services.reporter_service import ReporterService
    reporter = ReporterService()
    
    # 1. Visual Audit Report
    report_path = f"stage0_artifacts/{state['game_id']}/audit_report_{state['game_id']}.pdf"
    ref_img = state["internal_imgs_paths"][-1] if state.get("internal_imgs_paths") else None
    
    reporter.generate_audit_report(
        state["game_id"],
        state["game_title"],
        state["investigation"],
        report_path,
        reference_image_path=ref_img
    )
    
    # 2. Final Scribe Article PDF
    if state.get("article"):
        article_path = f"stage0_artifacts/{state['game_id']}/seo_article_{state['game_id']}.pdf"
        reporter.generate_article_pdf(
            state["game_title"],
            state["article"],
            article_path
        )
    
    state["report_path"] = report_path
    return state

# --- Build the Graph ---

workflow = StateGraph(AgentState)

workflow.add_node("capture", capture_node)
workflow.add_node("research", research_node)
workflow.add_node("analyze", analyze_node)
workflow.add_node("librarian", librarian_node)
workflow.add_node("architect", architect_node)
workflow.add_node("scribe", scribe_node)
workflow.add_node("reporter", reporter_node)

workflow.set_entry_point("capture")
workflow.add_edge("capture", "research")
workflow.add_edge("research", "analyze")
workflow.add_edge("analyze", "librarian")
workflow.add_edge("librarian", "architect")
workflow.add_edge("architect", "scribe")
workflow.add_edge("scribe", "reporter")
workflow.add_edge("reporter", END)

# Compile
app_graph = workflow.compile()

@traceable(run_type="chain", name="ArcadeBox SEO Pipeline")
async def run_pipeline_with_tracking(game_id: str, game_title: str, max_candidates: Optional[int] = None) -> Dict[str, Any]:
    initial_state = {
        "game_id": game_id,
        "game_title": game_title,
        "internal_capture_metadata": {},
        "internal_imgs_base64": [],
        "internal_imgs_paths": [],
        "investigation": {},
        "seo_blueprint": {},
        "grounded_context": {},
        "outline": {},
        "article": "",
        "accumulated_cost": 0.0,
        "status": "starting",
        "report_path": None,
        "max_candidates": max_candidates or settings.LIBRARIAN_MAX_CANDIDATES,
        "error_message": None
    }
    
    final_state = await app_graph.ainvoke(initial_state)
    logger.info(f"Pipeline finished with status: {final_state['status']} | Total Cost: ${final_state['accumulated_cost']:.4f}")
    
    # Clean up internal capture frames
    for path in final_state.get("internal_imgs_paths", []):
        if os.path.exists(path) and path.startswith("internal_"):
            os.remove(path)
            
    return final_state
