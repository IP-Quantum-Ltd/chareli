/**
 * Default FAQ Template for Games
 * Contains placeholders that get replaced at render time:
 * - [Game Name]: Replaced with game.title
 * - [Genre]: Replaced with game.category.name
 */

export const DEFAULT_FAQ_TEMPLATE = `
<h3>[Game Name] FAQ</h3>

<h4>Q: Is [Game Name] free to play?</h4>
<p>Yes! You can play [Game Name] for free on Arcades Box. We ensure all our games are accessible directly in your browser with no hidden fees or subscriptions.</p>

<h4>Q: How can I play [Game Name] unblocked?</h4>
<p>[Game Name] is available unblocked on Arcades Box. Our platform is optimized to provide a smooth, browser-based gaming experience that works on most school and work networks without the need for a VPN.</p>

<h4>Q: Do I need to download anything to play on mobile?</h4>
<p>No download is required. [Game Name] is a "no-download" HTML5 game. Whether you are on Android, iPhone, or a tablet, you can play instantly on Arcades Box using your mobile browser.</p>

<h4>Q: What is the best strategy for [Game Name]?</h4>
<p>To get a high score in [Game Name], focus on [Insert Strategy]. Learning the [Genre] patterns on Arcades Box is the fastest way to top the leaderboard!</p>

<h4>Q: Is [Game Name] safe for kids to play online?</h4>
<p>Absolutely. Arcades Box prioritizes family-friendly content. [Game Name] features safe, engaging gameplay suitable for children and players of all ages.</p>

<h4>Q: Will my high score be saved on Arcades Box?</h4>
<p>Most games on Arcades Box use your browser's local storage to save your progress and high scores. Make sure not to clear your browser cache if you want to keep your current stats!</p>
`;



export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * Parses an HTML string into FAQ items
 * Expected format: <h3>Title</h3> followed by pairs of <h4>Question</h4> and <p>Answer</p>
 */
export function parseFAQ(html: string): FAQItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const items: FAQItem[] = [];

  const headings = doc.querySelectorAll('h4');
  headings.forEach((heading) => {
    let answer = '';
    let next = heading.nextSibling;

    // Collect all nodes until the next H4 or end of container
    while (next) {
      // Stop if we hit the next H4
      if (next.nodeName === 'H4') break;

      if (next.nodeType === 1) { // Element Node
        answer += (next as Element).outerHTML;
      } else if (next.nodeType === 3) { // Text Node
        answer += next.textContent;
      }

      next = next.nextSibling;
    }

    // Clean up the question text (remove "Q: " prefix if present)
    let question = heading.textContent || '';
    if (question.startsWith('Q: ')) {
      question = question.substring(3);
    }

    items.push({
      question: question.trim(),
      answer: answer.trim()
    });
  });

  return items;
}

/**
 * Generates HTML string from FAQ items
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function generateFAQHtml(items: FAQItem[], _gameTitle?: string): string {
  if (items.length === 0) return '';

  let html = `<h3>[Game Name] FAQ</h3>\n\n`;

  items.forEach(item => {
    html += `<h4>Q: ${item.question}</h4>\n`;
    html += `${item.answer}\n\n`;
  });

  return html;
}

/**
 * Replaces template placeholders with actual game data
 * @param template - HTML template string with placeholders
 * @param game - Game object with title and category
 * @returns Rendered HTML with placeholders replaced
 */
export function renderFAQ(
  template: string,
  game: { title: string; category?: { name: string } }
): string {
  return template
    .split('[Game Name]').join(`<strong>${game.title}</strong>`)
    .split('[Genre]').join(game.category?.name || 'game');
}
