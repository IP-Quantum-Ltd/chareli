import logging
from typing import TypedDict, Dict, Any, List
from langgraph.graph import StateGraph, END
from app.services.browser_agent import capture_game_preview
from app.services.visual_librarian import VisualLibrarian
from app.services.analyst_agent import AnalystAgent
from app.services.architect_agent import ArchitectAgent
from app.services.scribe_agent import ScribeAgent
import base64
import os

logger = logging.getLogger(__name__)

class AgentState(TypedDict):
    """The state object passed between nodes in LangGraph."""
    proposal_id: str
    game_title: str
    internal_img_base64: str
    internal_img_path: str
    investigation: Dict[str, Any]
    seo_blueprint: Dict[str, Any]
    outline: Dict[str, Any]
    article: str
    accumulated_cost: float
    status: str
    error_message: str

# --- Node Implementations ---

async def capture_node(state: AgentState) -> AgentState:
    logger.info(f"Node: Capture | Proposal: {state['proposal_id']}")
    path = f"internal_{state['proposal_id']}.png"
    fallback_path = f"screenshot_{state['proposal_id']}.png"
    
    try:
        await capture_game_preview(state["proposal_id"], path)
        state["internal_img_path"] = path
        state["status"] = "captured"
    except Exception as e:
        logger.warning(f"Live capture failed, checking for fallback: {fallback_path}")
        if os.path.exists(fallback_path):
            state["internal_img_path"] = fallback_path
            state["status"] = "captured"
            logger.info(f"Using fallback screenshot: {fallback_path}")
        else:
            state["status"] = "failed"
            state["error_message"] = f"Capture failed and no fallback found: {e}"
            return state

    # Encode for Vision
    with open(state["internal_img_path"], "rb") as f:
        state["internal_img_base64"] = base64.b64encode(f.read()).decode("utf-8")
        
    return state

async def research_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Visual Research (Stage 0)")
    
    librarian = VisualLibrarian()
    result = await librarian.verify_and_research(state["game_title"], state["internal_img_base64"])
    
    state["accumulated_cost"] += librarian.last_cost
    
    if result["status"] == "failed":
        state["status"] = "failed"
        state["error_message"] = result["reason"]
    else:
        state["investigation"] = result
        state["status"] = "researched"
    return state

async def analyze_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: SEO Intelligence (Stage 1)")
    
    analyst = AnalystAgent()
    blueprint = await analyst.analyze_seo_potential(
        state["game_title"], 
        state["investigation"]["best_match"]["extracted_facts"]
    )
    state["accumulated_cost"] += analyst.last_cost
    state["seo_blueprint"] = blueprint
    state["status"] = "analyzed"
    return state

async def architect_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Architect (Stage 3)")
    
    architect = ArchitectAgent()
    outline = await architect.build_outline(state["game_title"], {
        "visual_description": state["investigation"]["best_match"]["reasoning"],
        "canonical_url": state["investigation"]["best_match"]["url"]
    })
    state["accumulated_cost"] += architect.last_cost
    state["outline"] = outline
    state["status"] = "architected"
    return state

async def scribe_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Scribe (Stage 5)")
    
    scribe = ScribeAgent()
    article = await scribe.draft_from_facts(state["game_title"], {
        "source_url": state["investigation"]["best_match"]["url"],
        "facts": state["investigation"]["best_match"]["extracted_facts"],
        "seo": state["seo_blueprint"]
    })
    state["accumulated_cost"] += scribe.last_cost
    state["article"] = article
    state["status"] = "complete"
    return state

# --- Build the Graph ---

workflow = StateGraph(AgentState)

workflow.add_node("capture", capture_node)
workflow.add_node("research", research_node)
workflow.add_node("analyze", analyze_node)
workflow.add_node("architect", architect_node)
workflow.add_node("scribe", scribe_node)

workflow.set_entry_point("capture")
workflow.add_edge("capture", "research")
workflow.add_edge("research", "analyze")
workflow.add_edge("analyze", END)

# Compile
app_graph = workflow.compile()

async def run_pipeline_with_tracking(proposal_id: str, game_title: str) -> Dict[str, Any]:
    initial_state = {
        "proposal_id": proposal_id,
        "game_title": game_title,
        "internal_img_base64": "",
        "internal_img_path": "",
        "investigation": {},
        "seo_blueprint": {},
        "outline": {},
        "article": "",
        "accumulated_cost": 0.0,
        "status": "starting",
        "error_message": ""
    }
    
    final_state = await app_graph.ainvoke(initial_state)
    logger.info(f"Pipeline finished with status: {final_state['status']} | Total Cost: ${final_state['accumulated_cost']:.4f}")
    
    # Clean up image ONLY if it was a temporary internal capture
    if final_state["internal_img_path"] and final_state["internal_img_path"].startswith("internal_") and os.path.exists(final_state["internal_img_path"]):
        os.remove(final_state["internal_img_path"])
        
    return final_state
