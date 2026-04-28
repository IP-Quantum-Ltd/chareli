import logging
import os
from pathlib import Path
from typing import Dict, Any, List
from fpdf import FPDF

logger = logging.getLogger(__name__)

class ReporterService:
    """
    Service to generate Visual Verification PDF Reports for the QA team.
    Includes baseline reference and full candidate gallery.
    """

    def generate_audit_report(
        self, 
        game_id: str, 
        game_title: str, 
        investigation: Dict[str, Any], 
        output_path: str,
        reference_image_path: str = None
    ):
        """
        Creates a PDF containing:
        - Game Title and ID
        - Baseline Reference Image (Target)
        - Winning Match Details
        - Verification Gallery (Discarded Candidates)
        """
        try:
            pdf = FPDF()
            pdf.set_auto_page_break(auto=True, margin=15)
            pdf.add_page()
            
            # 1. Header
            pdf.set_font("Arial", "B", 18)
            pdf.set_text_color(44, 62, 80)
            pdf.cell(190, 15, f"Visual Verification Audit: {game_title}", ln=True, align="C")
            pdf.set_font("Arial", "", 9)
            pdf.set_text_color(127, 140, 141)
            pdf.cell(190, 5, f"Game UUID: {game_id}", ln=True, align="C")
            pdf.ln(5)

            # 2. Baseline Reference (The Target we are looking for)
            if reference_image_path and os.path.exists(reference_image_path):
                pdf.set_font("Arial", "B", 12)
                pdf.set_text_color(52, 152, 219) # Blue
                pdf.cell(190, 10, "Target Baseline (Source: Staging)", ln=True)
                pdf.image(reference_image_path, w=100) # Slightly smaller baseline
                pdf.set_font("Arial", "I", 8)
                pdf.cell(190, 5, "Internal capture used for multi-modal grounding.", ln=True)
                pdf.ln(10)
            
            # 3. Executive Summary (The Winner)
            best_match = investigation.get("best_match", {})
            all_candidates = investigation.get("all_candidates", [])
            confidence = best_match.get("confidence_score", 0)
            
            pdf.set_font("Arial", "B", 14)
            pdf.set_text_color(39, 174, 96) # Green
            pdf.cell(190, 10, f"Winner: {confidence}% Confidence Match", ln=True)
            
            pdf.set_font("Arial", "", 10)
            pdf.set_text_color(0, 0, 0)
            pdf.cell(100, 8, f"Source URL: {best_match.get('url', 'N/A')}", ln=True)
            
            pdf.set_font("Arial", "B", 10)
            pdf.cell(190, 8, "Librarian Reasoning:", ln=True)
            pdf.set_font("Arial", "", 10)
            pdf.multi_cell(190, 5, best_match.get("reasoning", "No reasoning provided."))
            pdf.ln(5)

            # 4. Winning Asset Screenshot
            img_path = best_match.get("screenshot_path")
            if img_path and os.path.exists(img_path):
                pdf.image(img_path, w=170)
                pdf.ln(5)

            # Facts section (on new page)
            if best_match.get("extracted_facts"):
                pdf.add_page()
                pdf.set_font("Arial", "B", 14)
                pdf.cell(190, 10, "Grounding Analysis: Extracted Facts", ln=True)
                pdf.ln(5)
                facts = best_match.get("extracted_facts", {})
                for key, val in facts.items():
                    pdf.set_font("Arial", "B", 10)
                    pdf.cell(190, 8, f"{key.capitalize()}:", ln=True)
                    pdf.set_font("Arial", "", 10)
                    pdf.multi_cell(190, 6, str(val))
                    pdf.ln(2)

            # Gallery section
            other_candidates = [c for c in all_candidates if c.get("url") != best_match.get("url")]
            if other_candidates:
                pdf.add_page()
                pdf.set_font("Arial", "B", 14)
                pdf.set_text_color(192, 57, 43)
                pdf.cell(190, 10, "Research Gallery: Discarded Candidates", ln=True)
                pdf.ln(5)
                
                for i, cand in enumerate(other_candidates):
                    pdf.set_font("Arial", "B", 11)
                    pdf.set_text_color(0, 0, 0)
                    pdf.cell(190, 8, f"Candidate {i+1}: {cand.get('confidence_score')}% Score", ln=True)
                    pdf.multi_cell(190, 5, f"Rejection Note: {cand.get('reasoning')}")
                    
                    c_img = cand.get("screenshot_path")
                    if c_img and os.path.exists(c_img):
                        pdf.image(c_img, w=120)
                    pdf.ln(10)
                    if pdf.get_y() > 220: pdf.add_page()

            # Finalize
            output_dir = os.path.dirname(output_path)
            if output_dir: os.makedirs(output_dir, exist_ok=True)
            pdf.output(output_path)
            logger.info(f"Full Audit Report generated: {output_path}")
            return output_path
            
        except Exception as e:
            logger.error(f"PDF Generation failed: {e}", exc_info=True)
            return None

    def generate_article_pdf(self, game_title: str, article_markdown: str, output_path: str):
        """
        Converts the Scribe's markdown article into a professional PDF with basic formatting.
        """
        try:
            pdf = FPDF()
            pdf.set_auto_page_break(auto=True, margin=15)
            pdf.add_page()
            
            # Professional Header
            pdf.set_font("Arial", "B", 22)
            pdf.set_text_color(44, 62, 80)
            pdf.multi_cell(190, 15, game_title, align="C")
            pdf.ln(5)
            pdf.set_draw_color(44, 62, 80)
            pdf.line(20, pdf.get_y(), 190, pdf.get_y())
            pdf.ln(10)
            
            # Content Parsing Logic
            lines = article_markdown.split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    pdf.ln(5)
                    continue
                
                # Header Parsing
                if line.startswith('###'):
                    pdf.set_font("Arial", "B", 13)
                    pdf.set_text_color(52, 73, 94)
                    pdf.multi_cell(190, 10, line.replace('###', '').strip())
                    pdf.ln(2)
                elif line.startswith('##'):
                    pdf.set_font("Arial", "B", 15)
                    pdf.set_text_color(44, 62, 80)
                    pdf.multi_cell(190, 12, line.replace('##', '').strip())
                    pdf.ln(3)
                elif line.startswith('#'):
                    pdf.set_font("Arial", "B", 18)
                    pdf.set_text_color(44, 62, 80)
                    pdf.multi_cell(190, 15, line.replace('#', '').strip())
                    pdf.ln(4)
                else:
                    # Regular Paragraph with Bold Support
                    pdf.set_font("Arial", "", 11)
                    pdf.set_text_color(0, 0, 0)
                    
                    # Basic Bold detection (wraps line in bold if it's a bullet or specific marker)
                    clean_line = line.replace('**', '').replace('__', '').strip()
                    if line.startswith('* ') or line.startswith('- '):
                        pdf.set_font("Arial", "B", 11)
                        pdf.multi_cell(190, 7, f"• {clean_line[2:]}")
                    else:
                        pdf.multi_cell(190, 7, clean_line)
                    pdf.ln(2)
            
            # Finalize
            output_dir = os.path.dirname(output_path)
            if output_dir: os.makedirs(output_dir, exist_ok=True)
            pdf.output(output_path)
            
            logger.info(f"Professional Article PDF generated: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Article PDF Generation failed: {e}")
            return None
