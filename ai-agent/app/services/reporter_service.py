import logging
import os
from pathlib import Path
from typing import Dict, Any, List
from fpdf import FPDF

logger = logging.getLogger(__name__)

class ReporterService:
    """
    Service to generate Visual Verification PDF Reports for the QA team.
    """

    def generate_audit_report(self, game_id: str, game_title: str, investigation: Dict[str, Any], output_path: str):
        """
        Creates a PDF containing:
        - Game Title and ID
        - Visual Confidence Score
        - Correlation Reasoning
        - Best Match URL
        - Facts Extracted
        """
        try:
            pdf = FPDF()
            pdf.set_auto_page_break(auto=True, margin=15)
            pdf.add_page()
            
            # Header
            pdf.set_font("Arial", "B", 16)
            pdf.cell(190, 10, f"Visual Verification Report: {game_title}", ln=True, align="C")
            pdf.set_font("Arial", "", 10)
            pdf.cell(190, 10, f"Game UUID: {game_id}", ln=True, align="C")
            pdf.ln(10)
            
            # Summary Section
            best_match = investigation.get("best_match", {})
            confidence = best_match.get("confidence_score", 0)
            
            pdf.set_font("Arial", "B", 12)
            pdf.cell(190, 10, "1. Executive Summary", ln=True)
            pdf.set_font("Arial", "", 11)
            pdf.cell(100, 8, f"Confidence Score: {confidence}%", ln=True)
            pdf.cell(100, 8, f"Source URL: {best_match.get('url', 'N/A')}", ln=True)
            pdf.ln(5)
            
            # Reasoning Section
            pdf.set_font("Arial", "B", 12)
            pdf.cell(190, 10, "2. Visual Correlation Reasoning", ln=True)
            pdf.set_font("Arial", "", 10)
            pdf.multi_cell(190, 6, best_match.get("reasoning", "No reasoning provided."))
            pdf.ln(5)
            
            # Facts Section
            pdf.set_font("Arial", "B", 12)
            pdf.cell(190, 10, "3. Extracted Game Facts", ln=True)
            pdf.set_font("Arial", "", 10)
            facts = best_match.get("extracted_facts", {})
            for key, val in facts.items():
                pdf.set_font("Arial", "B", 10)
                pdf.cell(40, 6, f"{key.capitalize()}:", ln=False)
                pdf.set_font("Arial", "", 10)
                pdf.multi_cell(150, 6, str(val))
            
            # Screenshots Section (Embedded)
            # Find candidate images in stage0_artifacts
            pdf.ln(10)
            pdf.set_font("Arial", "B", 12)
            pdf.cell(190, 10, "4. Verification Assets", ln=True)
            
            img_path = best_match.get("screenshot_path")
            if img_path and os.path.exists(img_path):
                pdf.image(img_path, w=170)
                pdf.set_font("Arial", "I", 8)
                pdf.cell(190, 5, f"Caption: Winning external candidate capture from {best_match.get('url')}", ln=True, align="C")

            # Finalize
            output_dir = os.path.dirname(output_path)
            if output_dir:
                os.makedirs(output_dir, exist_ok=True)
                
            pdf.output(output_path)
            logger.info(f"PDF Audit Report generated: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"PDF Generation failed: {e}", exc_info=True)
            return None
