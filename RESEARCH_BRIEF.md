# Research Brief: Dense Workflow Knowledge for Computational Tools

## Context

We're building **bit.canvas** - a spatial computational environment that combines infinite canvas organization with code execution, file management, and ambient intelligence. The tool aims to bridge thinking and computing on the same surface.

**Current problem:** We have a clear technical vision but lack dense, visceral understanding of how real users work with existing computational tools (Jupyter, Excel, Observable, VSCode). There's significant distance between our imagined use cases and actual workflows that lead to breakthroughs.

**Goal:** Acquire concrete, detailed knowledge about real computational workflows to inform feature prioritization and design decisions.

---

## Research Questions

### Primary Questions

1. **What does a real data analysis workflow look like minute-by-minute?**
   - Not: "They analyze data in Jupyter"
   - Need: "Started 9am, loaded dataset (15min wait), wrote cleaning pipeline (30 cells, 2 hours), pipeline failed at cell 23..."

2. **What are the actual pain points that users experience repeatedly?**
   - Not: "Managing large notebooks is hard"
   - Need: "After 50 cells, can't remember what cell 12 does. Scrolling is tedious. Re-running takes 20 minutes. Kernel crashes lose all state."

3. **When do users abandon their tool and switch to something else?**
   - Need specific moments: "Tried to do X in Jupyter, gave up after Y hours, switched to Z because..."

4. **What patterns and practices emerge in real projects?**
   - File organization strategies
   - Notebook/spreadsheet structure
   - Code reuse approaches
   - Collaboration methods
   - Documentation habits

5. **What does "breakthrough" work actually look like?**
   - Concrete examples of significant work done in these tools
   - What made it possible?
   - What were the limiting factors?

---

## Research Tasks

### Task 1: Find and Analyze Real Workflows

**Deliverable:** 5-10 detailed workflow case studies

**Where to look:**
- YouTube: "Jupyter workflow", "data analysis tutorial", "Excel financial modeling" (long videos, 1-2+ hours)
- Kaggle: Competition notebooks (especially winners)
- Observable: Featured notebooks, especially from NYT/data journalists
- GitHub: Jupyter notebooks with >100 stars
- Academic repos: Reproducibility repositories

**What to document for each:**
- **Time breakdown:** How long on each task?
- **Pain points:** Where did they struggle? What failed?
- **Scale:** How many cells/sheets? How much data?
- **Patterns:** What do they do repeatedly?
- **Workarounds:** What hacks/tricks did they use?
- **Context switches:** When did they leave the tool?

**Example of good documentation:**
```
Workflow: Kaggle Competition - House Price Prediction
Duration: Video shows 2.5 hours of work
Cells: 73 total
Structure:
- Cells 1-15: Data loading and exploration (45 min)
  - Pain point: Had to restart kernel twice due to memory issues
  - Workaround: Loaded data in chunks
- Cells 16-40: Feature engineering (1 hour)
  - Pattern: Lots of copy-paste with slight modifications
  - Pain point: Difficult to compare different feature sets
- Cells 41-73: Model training and evaluation (45 min)
  - Pain point: Each model takes 5 min to train, blocking UI
  - Workaround: Added print statements for progress

Key frustrations observed:
- "I wish I could run these in parallel"
- "I've lost track of which features I've tried"
- Spent 20 minutes debugging a cell that worked yesterday
```

### Task 2: Collect "War Stories" from Communities

**Deliverable:** 20-30 significant pain points with context

**Where to look:**
- Jupyter Discourse
- r/datascience
- r/excel
- Hacker News: Search "jupyter notebook", "excel", "observable"
- Observable community forums
- Stack Overflow: Highly upvoted questions

**What to capture:**
- **Problem:** What went wrong?
- **Context:** What were they trying to do?
- **Impact:** How much time lost? What was blocked?
- **Solution:** How did they fix it (or did they give up)?

**Example format:**
```
Title: "My 200-cell notebook is unmaintainable"
Source: Reddit r/datascience
Context: Data scientist working on customer churn model
Problem: Notebook grew organically over 3 months, now can't navigate it
Quote: "I have to Ctrl+F to find anything. Half the cells are experiments I never cleaned up. Takes 45 minutes to run top-to-bottom."
Impact: Estimated 2-3 hours/week lost to navigation and re-running
Solution: Started breaking into multiple notebooks, but lost shared state
Lesson: Organization/navigation becomes critical after ~50 cells
```

### Task 3: Document Real Breakthrough Examples

**Deliverable:** 5-8 concrete examples of significant work

**Criteria:**
- Published research OR production product OR viral visualization
- Clear evidence of tool used (Jupyter/Excel/Observable)
- Accessible documentation of process

**What to document:**
- **Project:** What was created?
- **Tool used:** Which tool and why?
- **Scale:** How complex?
- **Breakthrough:** What did it enable?
- **Tool limitations:** Where did the tool struggle?
- **Would spatial canvas help?** Honest assessment

**Examples to find:**
- COVID-19 analysis notebooks (Johns Hopkins, NYT)
- Financial crisis modeling (Excel spreadsheets)
- Observable COVID visualizations
- Climate research notebooks
- Kaggle competition winners

### Task 4: Extract Common Patterns

**Deliverable:** Pattern catalog with frequencies

**Patterns to identify:**

**Organizational patterns:**
- How do users structure large notebooks? (sections, numbering, markdown headers)
- File organization strategies (multiple notebooks, data folders, exports)
- Naming conventions

**Workflow patterns:**
- Do they work top-to-bottom or jump around?
- How often do they restart kernels?
- When do they create new notebooks vs continue existing?

**Pain point patterns:**
- What breaks most often?
- What's most tedious?
- What takes unexpected time?

**Workaround patterns:**
- Common hacks and tricks
- Copy-paste patterns
- External tools used alongside

**Example output:**
```
Pattern: "Data Cleaning Notebook Separate from Analysis"
Frequency: 8/10 workflows observed
Description: Users create one notebook for data cleaning (outputs clean CSV), then separate notebook for analysis
Reason: "Cleaning takes forever to run, don't want to rerun it"
Pain point: Managing dependencies between notebooks
Workaround: Manually track which clean data goes with which analysis
```

### Task 5: Interview Transcripts (If Possible)

**Deliverable:** 3-5 user interviews (can be found interviews, not necessarily original)

**Look for:**
- Podcast interviews with data scientists/analysts
- Conference talks about workflows
- "Day in the life" blog posts
- YouTube "how I work" videos

**Extract:**
- Tool choices and reasons
- Typical day/week workflow
- Biggest frustrations
- Dream features
- When they use multiple tools

---

## Output Format

### Primary Deliverable: Research Report (Markdown)

Structure:
```markdown
# Dense Workflow Research Report

## Executive Summary
- Key findings (5-7 bullet points)
- Implications for bit.canvas

## Part 1: Workflow Case Studies
[Detailed case studies from Task 1]

## Part 2: Pain Point Catalog
[Organized by severity/frequency from Task 2]

## Part 3: Breakthrough Examples
[Case studies from Task 3]

## Part 4: Pattern Analysis
[Common patterns from Task 4]

## Part 5: User Voices
[Quotes and insights from Task 5]

## Part 6: Implications for bit.canvas
- What features would actually address real pain points?
- What are we building that nobody needs?
- What are we missing that users desperately want?
- Honest assessment: Would spatial canvas help these workflows?
```

### Secondary Deliverable: Quick Reference Sheet

One-page summary:
- Top 10 pain points (by frequency)
- Top 5 workflow patterns
- Top 3 breakthrough examples
- Decision checklist: "Should bit.canvas have X feature?"

---

## Success Criteria

**Good research will:**
- ✅ Be specific (names, numbers, timestamps)
- ✅ Include direct quotes from real users
- ✅ Show actual workflows, not idealized ones
- ✅ Capture failures and workarounds, not just successes
- ✅ Provide enough detail to viscerally understand the experience

**Bad research would be:**
- ❌ Generic summaries ("Jupyter is good for data analysis")
- ❌ Feature lists from documentation
- ❌ Our own assumptions reflected back
- ❌ Theoretical use cases instead of observed reality

---

## Specific Tools to Research

### Primary Focus: Jupyter Notebooks
- Most similar to what we're building
- Rich ecosystem to learn from
- Well-documented pain points

**Key areas:**
- Large notebook management (50+ cells)
- Kernel management and state
- Collaboration and sharing
- Reproducibility challenges
- Extension ecosystem

### Secondary Focus: Excel
- Ubiquitous, battle-tested
- Spatial (grid) but rigid
- Good for understanding "non-programmers doing computation"

**Key areas:**
- Complex spreadsheet structures (many tabs, formulas)
- Financial modeling workflows
- Where Excel breaks down (users move to Python)
- Why Excel persists despite alternatives

### Tertiary Focus: Observable
- Reactive execution model (relevant to our vision)
- Spatial ambitions (but still linear)
- Modern, web-first

**Key areas:**
- How reactivity helps/hurts
- Visualization workflows
- Collaboration features
- Why it hasn't replaced Jupyter

---

## Timeline Suggestion

- **Days 1-2:** Task 1 (Workflow case studies) - 5 detailed examples
- **Days 3-4:** Task 2 (Pain point collection) - 20-30 stories
- **Day 5:** Task 3 (Breakthrough examples) - 5 examples
- **Day 6:** Task 4 (Pattern extraction) - Analyze findings
- **Day 7:** Task 5 (Interview research) - 3-5 sources
- **Day 8:** Synthesize into report

**Total:** ~8 days of focused research

---

## Questions to Keep in Mind

As you research, continuously ask:

1. **Would bit.canvas solve this problem?**
   - Be honest - sometimes the answer is no

2. **Is this a real problem or a theoretical one?**
   - Look for evidence of frequency and impact

3. **What's the minimum feature set that would help?**
   - Avoid over-engineering

4. **Would spatial organization actually matter here?**
   - Some workflows are inherently linear

5. **What can we learn from how users work around limitations?**
   - Workarounds reveal unmet needs

---

## Background: What is bit.canvas?

For context while researching:

**Current features:**
- Infinite spatial grid for text/content
- Bounds (vertical linear documents)
- Lists (scrollable containers)
- Command system

**Planned features:**
- Code execution in list objects (IDE-like)
- File management (spatial, not hierarchical)
- Reactive computation (Observable-style)
- Ambient scripting (intelligent automation)

**Core hypothesis:**
Separating "thinking space" from "computing space" creates friction. Magical grid paper where brainstorming → scripting happens seamlessly could reduce context switching.

**Key uncertainty:**
Is spatial organization actually valuable for computational workflows, or is it a solution looking for a problem?

This research should help answer that question honestly.

---

## Contact for Questions

[Your contact information]

**Research philosophy:** We want truth, not validation. If research reveals spatial canvas isn't useful for these workflows, that's valuable information. Be skeptical, be thorough, be honest.
