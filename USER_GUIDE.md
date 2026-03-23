# Karl Jr User Guide

Karl Jr is a browser extension that helps SF.gov content managers create better, more accessible content. It provides quick access to page information and runs accessibility tests directly in your browser.

---

## Getting Started

### Installation

1. Download the latest version from the Chrome Web Store (or load the unpacked extension from your IT team)
2. The Karl Jr icon will appear in your browser toolbar
3. Navigate to any SF.gov page to see the side panel

### Opening Karl Jr

Karl Jr automatically opens when you visit SF.gov pages. You can also:
- Click the Karl Jr icon in your browser toolbar
- Use the keyboard shortcut: **Ctrl+Shift+Y** (Windows) or **Cmd+Shift+Y** (Mac)

---

## Features

### Page Information

View essential details about the current SF.gov page:

**Edit on Karl**
- Quick link to edit the page in Wagtail CMS
- Opens directly to the page editor

**Metadata**
- Page title and content type
- Partner agency information
- Page ID for reference

**Translations**
- See all available language versions
- Direct links to translated pages
- Language codes displayed (e.g., EN, ES, ZH, TL)

**Images and Documents**
- List of all media assets on the page
- File names and types
- Warning indicators for images missing alt text

**Links**
- Document links used on the page
- Quick reference for content review

### Accessibility Checker

Run comprehensive accessibility tests to ensure your content meets SF.gov standards.

#### How to Use

1. Navigate to the page you want to test
2. Open Karl Jr side panel
3. Scroll to the "Accessibility" section
4. Click **"Run accessibility tests"**
5. Review the results

#### What Gets Checked

**Heading Nesting**
- Verifies headings follow proper hierarchy (H1 → H2 → H3)
- Screen readers rely on heading structure for navigation
- Issues are highlighted in yellow on the page

**Image Alt Text**
- Identifies images missing alternative text descriptions
- Shows which images need attention in the CMS
- Essential for users who can't see images

**Inaccessible Links**
- Finds vague link text like "click here" or "read more"
- Detects raw URLs pasted into content
- Flags vague button text
- Issues are highlighted in purple on the page

**Table Accessibility**
- Checks that tables have captions (titles)
- Verifies tables have header rows or columns
- Tables with issues are highlighted in red on the page

**Video Accessibility**
- Ensures videos have captions or subtitles
- Checks for text transcripts near videos
- Videos with issues are highlighted in red on the page

**Readability Score**
- Calculates grade level using the Automated Readability Index
- SF.gov aims for 8th grade level or lower
- Shows specific factors affecting readability:
  - Average sentence length
  - Average word length
  - Complex words used
- Identifies content structure issues:
  - Paragraphs with too many sentences (aim for 1-2)
  - Long sections without headings (break up after 150 words)

#### Understanding Readability Scores

| Score | Grade Level | Interpretation |
|-------|-------------|----------------|
| 0-8 | Elementary to 8th grade | ✅ Meets SF.gov accessibility goals |
| 9-10 | High school | ⚠️ Consider simplifying |
| 11-12 | College | ⚠️ Too complex for most readers |
| 13+ | Post-graduate | ❌ Needs significant simplification |

**Color coding:**
- Green: Good (8th grade or below)
- Amber: Acceptable (9-10th grade)
- Orange: Needs improvement (11-12th grade)
- Red: Too complex (post-graduate level)

### Hemingway App Integration

Get additional writing suggestions from Hemingway App, a popular readability tool.

#### How to Use

1. Run accessibility tests
2. Scroll to the "Readability score" section
3. Click **"Get help in Hemingway App"**
4. Read the instructions that appear
5. Click **"Open Hemingway App"** when ready
6. In Hemingway:
   - Clear any existing text (it may show text from your last session)
   - Paste with Ctrl+V (or Cmd+V on Mac)
   - Compare the scores and review suggestions

**What Hemingway shows:**
- Sentences that are hard to read (highlighted in yellow/red)
- Simpler word alternatives
- Passive voice usage
- Adverb overuse

The text from your SF.gov page is automatically copied to your clipboard, ready to paste.

### User Feedback

View feedback submitted by SF.gov visitors about the current page:

- See helpful/not helpful ratings
- Read user comments and suggestions
- Understand how visitors experience your content
- Use feedback to improve pages

### Form Confirmation Pages

For pages with form confirmation content:
- Quick link to view the confirmation page
- Helps verify the complete user journey

---

## Tips for Better Content

### Writing for Accessibility

1. **Use short sentences** - Aim for 15-20 words per sentence
2. **Break up paragraphs** - 1-2 sentences per paragraph is ideal
3. **Add headings frequently** - Every 150 words or so
4. **Use simple words** - Choose "use" over "utilize", "help" over "assist"
5. **Write descriptive links** - "Apply for a marriage license" instead of "click here"
6. **Add alt text to images** - Describe what's in the image for screen reader users
7. **Caption your tables** - Give every table a clear title
8. **Make videos accessible** - Include both captions and a text transcript

### Using the Accessibility Checker Effectively

- **Run tests before publishing** - Catch issues early
- **Fix issues in order** - Start with heading nesting, then images, then links
- **Use visual highlights** - Issues are marked on the page to help you find them
- **Check readability last** - After fixing structural issues, focus on simplifying language
- **Use Hemingway for polish** - Get sentence-level suggestions after your score is close to 8

### Common Issues and Fixes

**"Improperly nested headings"**
- Don't skip heading levels (H1 → H3 is wrong)
- Use H2 for main sections, H3 for subsections
- Fix in the CMS by changing heading levels

**"Missing alt text"**
- Look for the ⚠️ warning icon under "Images and documents"
- Click the image to edit in the CMS
- Add a brief description in the alt text field

**"Vague link text"**
- Replace "click here" with descriptive text
- Example: "click here for forms" → "download marriage license forms"
- Edit the link text in the CMS

**"Missing table caption"**
- Add a title in the "Caption" field in the table editor
- The caption should describe what the table shows

**"High readability score"**
- Break long sentences into shorter ones
- Replace complex words with simpler alternatives
- Add more headings to break up long sections
- Use Hemingway App for specific suggestions

---

## Keyboard Shortcuts

- **Open/close side panel**: Ctrl+Shift+Y (Windows) or Cmd+Shift+Y (Mac)
- **Navigate between sections**: Tab key
- **Expand/collapse cards**: Enter or Space when focused on card header
- **Activate buttons**: Enter or Space when focused

---

## Troubleshooting

**Side panel doesn't open**
- Make sure you're on an SF.gov page (*.sf.gov)
- Try clicking the Karl Jr icon in your toolbar
- Refresh the page and try again

**"No active tab found" error**
- Refresh the SF.gov page
- Close and reopen the side panel
- Make sure you're on an SF.gov page, not a different site

**Accessibility tests show blank results**
- Make sure the page has finished loading
- Try running the tests again
- Check that you're logged into Wagtail CMS

**Can't copy text to Hemingway**
- Your browser may have blocked clipboard access
- Manually copy the page text and paste into Hemingway
- Check browser permissions for the extension

---

## Privacy & Data

**What Karl Jr accesses:**
- Page content on SF.gov for accessibility testing
- Your Wagtail CMS session (to verify you're logged in)
- User feedback data from Airtable

**What Karl Jr does NOT do:**
- Track your browsing on non-SF.gov sites
- Store your personal information
- Share data with third parties
- Work on pages outside *.sf.gov domains

---

## Support

**Need help?**
- Contact the Digital Services team
- Submit feedback through the extension

**Found a bug?**
- Use the feedback form in Karl Jr
- Include the page URL and what you were trying to do

**Feature requests?**
- Submit through the feedback form
- Let us know how Karl Jr can better support your work

---

## Version History

See `RELEASE_NOTES_0.4.0.md` for the latest updates and new features.
