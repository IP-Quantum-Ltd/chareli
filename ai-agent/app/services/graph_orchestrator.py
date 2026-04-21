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
from langsmith import traceable

logger = logging.getLogger(__name__)

class AgentState(TypedDict):
    """The state object passed between nodes in LangGraph."""
    proposal_id: str
    game_title: str
    internal_imgs_base64: List[str]  # Updated to handle dual frames
    internal_imgs_paths: List[str]
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
    
    try:
        # returns a list of 2 paths
        paths = await capture_game_preview(state["proposal_id"], "internal")
        state["internal_imgs_paths"] = paths
        
        # FAIL-FAST: Verify we actually got screenshots
        if not paths or len(paths) < 2:
            raise ValueError("Failed to capture both internal frames.")
            
        # Encode both for multi-modal vision
        state["internal_imgs_base64"] = []
        for p in paths:
            with open(p, "rb") as f:
                state["internal_imgs_base64"].append(base64.b64encode(f.read()).decode("utf-8"))
        
        state["status"] = "captured"
    except Exception as e:
        logger.error(f"Capture Integrity Failed: {e}")
        state["status"] = "failed"
        state["error_message"] = f"CRITICAL: Internal capture failed. Pipeline terminated. Detail: {e}"
        # Pipeline stops here because research_node checks status
        
    return state

async def research_node(state: AgentState) -> AgentState:
    if state["status"] == "failed": return state
    logger.info("Node: Visual Research (Stage 0)")
    
    librarian = VisualLibrarian()
    # Pass the list of images
    result = await librarian.verify_and_research(state["game_title"], state["internal_imgs_base64"])
    
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

@traceable(run_type="chain", name="ArcadeBox SEO Pipeline")
async def run_pipeline_with_tracking(proposal_id: str, game_title: str) -> Dict[str, Any]:
    initial_state = {
        "proposal_id": proposal_id,
        "game_title": game_title,
        "internal_imgs_base64": [],
        "internal_imgs_paths": [],
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
    
    # Clean up multiple internal frames
    for path in final_state.get("internal_imgs_paths", []):
        if os.path.exists(path):
            os.remove(path)
            logger.info(f"Cleaned up temporal asset: {path}")
            
    return final_state

