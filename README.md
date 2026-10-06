# NC Primary Elections Guide

An interactive guide to North Carolina's top primary elections, built for The Assembly.

## Live Site

- **GitHub Pages**: https://austinbrian.github.io/26-nc-primaries-for-2026/
- **Data source**: `races.json`

## Quick Start

```bash
# Run locally
python3 -m http.server 8000
# Open http://localhost:8000
```

## Updating Race Data

Edit `races.json` directly. Each race has:

```json
{
  "rank": 1,
  "title": "Senate District 26 Republican Primary",
  "party": "Republican",        // "Republican" or "Democratic"
  "type": "State Senate",       // "State Senate", "State House", "U.S. House", "U.S. Senate", "Judicial"
  "location": "Rockingham & Guilford Counties",
  "candidates": [
    {
      "name": "Phil Berger",
      "role": "Incumbent",      // "Incumbent", "Challenger", "Candidate", "Frontrunner", "Appointed Incumbent"
      "description": "State Senate leader since 2011..."
    }
  ],
  "summary": "The main story...",
  "stakes": "Why it matters...",
  "keyIssues": ["Issue 1", "Issue 2"],
  "keyFact": "Key statistic or detail..."
}
```

After editing, commit and push:

```bash
git add races.json
git commit -m "Update race data"
git push
```

Changes appear on GitHub Pages within a few minutes.

## WordPress Integration

### Option 1: Iframe (Recommended)

Add this to a Custom HTML block in WordPress:

```html
<iframe
  src="https://austinbrian.github.io/matchup-guide/"
  width="100%"
  height="900"
  style="border: none;">
</iframe>
```

**Pros**: Easiest to maintain. Update GitHub, WordPress updates automatically.
**Cons**: Iframe may have scrollbar issues on some themes.

### Option 2: Embedded HTML Block

1. Copy the entire contents of `wordpress-embed.html`
2. In WordPress: Add page → Add block → Custom HTML → Paste
3. The embed fetches `races.json` from GitHub, so data updates are automatic

**To update the embed after style/JS changes:**

```bash
./build-wordpress.sh austinbrian
git add -A && git commit -m "Update WordPress embed"
git push
```

Then re-copy `wordpress-embed.html` into WordPress.

## File Structure

```
├── index.html           # Main page
├── styles.css           # Styles
├── app.js               # JavaScript
├── races.json           # Race data (edit this to update content)
├── wordpress-embed.html # Self-contained WordPress version
├── build-wordpress.sh   # Script to update WordPress embed
└── ncprimaries.md       # Source text from The Assembly articles
```

## Features

- **4 View Modes**: Skim, Peek, Peruse, Deep Dive
- **Filters**: By party (GOP/Dem) and race type (Congress, Senate, House, Judicial)
- **Click to Expand**: Click any card to see more details
- **Responsive**: Works on mobile and desktop

## Source Articles

- [Top 10 Primaries](https://www.theassemblync.com/news/politics/elections/north-carolina-2026-top-primary-elections/)
- [16 More Primaries](https://www.theassemblync.com/news/politics/elections/16-more-north-carolina-primaries-2026/)

## Credits

By Bryan Anderson, The Assembly
