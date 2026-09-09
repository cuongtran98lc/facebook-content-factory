# MASTER PROMPT — UPGRADE EXISTING APP INTO STICKMAN CONTENT ENGINE

## ROLE

You are a Senior Full-Stack Engineer, AI Product Architect, UX Designer, and YouTube Content Automation Specialist.

You are working inside an EXISTING application.

Your job is NOT to rebuild the application from scratch.

Your job is to:

1. Inspect the current codebase.
2. Understand the existing architecture.
3. Identify reusable components and services.
4. Preserve existing working functionality.
5. Upgrade the application into a scalable **Stickman Story Content Engine** designed primarily for international YouTube audiences.

Do not make large architectural changes unless they are justified.

Before implementing anything, inspect the project.

---

# 1. PRODUCT GOAL

Transform the existing application into an AI-assisted content production system for:

- YouTube Shorts
- YouTube Long-form
- Stickman animation
- Storytelling
- International English-speaking audiences

Primary target markets:

- United States
- United Kingdom
- Canada
- Australia

Primary content language:

American English.

The application should help the creator move through this pipeline:

IDEA
↓
CONTENT PILLAR
↓
STORY CONCEPT
↓
HOOK
↓
STORY STRUCTURE
↓
SCRIPT
↓
SCENES
↓
STORYBOARD
↓
CHARACTERS
↓
VISUAL PROMPTS
↓
VOICEOVER
↓
VIDEO PLAN
↓
TITLE
↓
THUMBNAIL
↓
DESCRIPTION
↓
PUBLISH
↓
ANALYTICS
↓
LEARN
↓
GENERATE NEXT IDEAS

The system must NOT behave like a generic "AI generate 100 ideas" tool.

It should behave like a **content intelligence + story generation engine**.

---

# 2. FIRST TASK — AUDIT CURRENT APPLICATION

Before modifying code:

Inspect:

- project structure
- package.json
- framework
- frontend architecture
- backend architecture
- database/schema
- API routes
- AI integrations
- authentication
- state management
- existing components
- existing content generation workflow
- prompt templates
- video/image generation integrations
- reusable utilities
- existing models/types
- environment configuration

Then produce:

## CURRENT SYSTEM

Explain how the current application works.

## REUSABLE

List components/services/modules that should remain.

## PROBLEMS

Identify:

- architectural problems
- duplicated logic
- hard-coded prompts
- scalability issues
- UX issues
- data-model limitations

## GAP ANALYSIS

Compare the existing system against the target Stickman Content Engine.

## IMPLEMENTATION PLAN

Create a prioritized plan:

P0 = required

P1 = important

P2 = optimization

Do NOT start rewriting random files before completing this analysis.

---

# 3. CONTENT STRATEGY MODEL

The application should organize content around emotional triggers rather than random topics.

Create Content Pillars.

Initial pillars:

1. Betrayal
2. Revenge
3. Karma
4. Mystery
5. Relationship
6. Underdog
7. Awkward Life
8. Dark Twist
9. Workplace Drama
10. Family Conflict
11. Friendship Drama
12. Creepy Stories

Each pillar should contain:

- name
- description
- target emotion
- target audience
- suitable video formats
- recommended hooks
- common conflicts
- possible twists
- possible endings
- historical performance

Do NOT hard-code the architecture specifically to these 12 pillars.

The user must be able to add/edit/archive pillars.

---

# 4. STORY ENGINE

Build a modular Story Engine.

A story should be generated from:

Story =
Character
+ Goal
+ Relationship
+ Environment
+ Conflict
+ Escalation
+ Reveal
+ Twist
+ Payoff

Create reusable dimensions.

## CHARACTERS

Examples:

- Student
- Employee
- Boss
- Boyfriend
- Girlfriend
- Husband
- Wife
- Best Friend
- Roommate
- Neighbor
- Teacher
- Parent
- Sibling
- Stranger
- Rich Person
- Poor Person
- Bully
- Quiet Kid

## ENVIRONMENTS

Examples:

- School
- Office
- Apartment
- House
- Street
- Restaurant
- Coffee Shop
- Hospital
- Wedding
- Airport
- Car
- Hotel
- Party
- Store

## CONFLICTS

Examples:

- cheating
- betrayal
- humiliation
- rejection
- bullying
- jealousy
- secret
- lie
- theft
- unfair firing
- manipulation
- disappearance
- hidden identity

## TWISTS

Examples:

- wrong assumption
- hidden identity
- secret recording
- unexpected witness
- fake poverty
- secret relationship
- hidden inheritance
- unexpected connection
- betrayal revealed
- misunderstanding
- character knew everything

## ENDINGS

Examples:

- karma
- revenge
- reconciliation
- bittersweet
- happy ending
- sad ending
- open ending
- dark twist
- unexpected success
- second twist

These must be manageable data entities rather than only text inside prompts.

---

# 5. IDEA GENERATOR

Create an Idea Generator that combines Story Engine dimensions intelligently.

INPUT:

- Content Pillar
- Target Country
- Target Audience
- Video Type
- Desired Emotion
- Tone
- Story Length
- Number of Ideas
- Optional Seed Idea

Video Type:

SHORT
LONG

The engine should generate structured output.

Each idea should include:

- workingTitle
- premise
- mainCharacter
- supportingCharacters
- relationship
- setting
- conflict
- emotionalTrigger
- twist
- ending
- hook
- whyItMayWork
- originalityAngle
- recommendedFormat
- estimatedStoryComplexity

Avoid generating near-duplicate concepts.

---

# 6. IDEA SCORING

Every idea should receive an AI-assisted score.

Score from 0–100.

Calculate dimensions such as:

HOOK_STRENGTH
CURIOSITY
EMOTIONAL_INTENSITY
RELATABILITY
TWIST_POTENTIAL
VISUAL_POTENTIAL
SERIES_POTENTIAL
ORIGINALITY
PRODUCTION_DIFFICULTY

Show something similar to:

Overall Score: 87/100

Hook: 92
Curiosity: 90
Emotion: 84
Visual: 81
Series Potential: 88

Do not present these scores as guaranteed predictions of YouTube performance.

They are content-development heuristics.

---

# 7. HOOK ENGINE

For every concept generate multiple hooks.

Generate:

- Shock Hook
- Curiosity Hook
- Dialogue Hook
- Conflict Hook
- Mystery Hook

Example:

Concept:

Girlfriend leaves protagonist because he is poor.

Hooks:

"My girlfriend dumped me because I was broke."

"She called me a loser in front of everyone."

"I never told my girlfriend how much money I actually had."

"She left me for a rich guy. Five years later, he walked into my office."

Allow the user to:

- regenerate
- edit
- select
- save favorite

The selected hook becomes part of the story generation context.

---

# 8. SHORTS SCRIPT ENGINE

Default target:

30–60 seconds.

Recommended structure:

0–2 sec
HOOK

2–8 sec
CONTEXT

8–20 sec
CONFLICT

20–35 sec
ESCALATION

35–48 sec
TWIST

48–58 sec
PAYOFF

58–60 sec
NEXT STORY / LOOP / CTA

Do not force exact timestamps when the story requires different pacing.

Each section should include:

- narration
- dialogue
- visual action
- emotion
- character
- camera/framing suggestion
- sound suggestion
- duration estimate

---

# 9. LONG-FORM SCRIPT ENGINE

Support approximately:

5–15 minute videos.

Default structure:

COLD OPEN
↓
CURIOSITY GAP
↓
SETUP
↓
INCITING INCIDENT
↓
RISING CONFLICT
↓
FIRST REVEAL
↓
ESCALATION
↓
MAJOR TWIST
↓
CLIMAX
↓
CONSEQUENCE
↓
PAYOFF
↓
NEXT STORY HOOK

The system should allow section-level editing.

Users should be able to regenerate ONE section without destroying the rest of the script.

Preserve character consistency and facts when regenerating.

---

# 10. SCENE GENERATOR

Convert scripts into scenes.

Scene schema should contain fields similar to:

{
  sceneNumber,
  duration,
  location,
  characters,
  narration,
  dialogue,
  action,
  emotion,
  camera,
  visualDescription,
  imagePrompt,
  animationPrompt,
  soundEffect,
  transition
}

Do NOT make downstream features parse raw screenplay text.

Use structured data.

---

# 11. STICKMAN CHARACTER SYSTEM

Create reusable character identities.

Character fields:

- id
- name
- role
- genderPresentation
- ageRange
- bodyStyle
- headStyle
- clothing
- accessories
- primaryExpression
- personality
- visualDescription
- promptDescription

Expression library:

- normal
- happy
- sad
- angry
- shocked
- scared
- smug
- confused
- crying
- laughing
- suspicious
- embarrassed

Characters must remain visually consistent between scenes.

Generate a persistent `characterPrompt` and reuse it.

Never independently redesign a character for every scene.

---

# 12. LOCATION LIBRARY

Create reusable locations.

Examples:

BEDROOM
OFFICE
SCHOOL
STREET
RESTAURANT
HOSPITAL
HOUSE
CAR
WEDDING
AIRPORT
CAFE
HOTEL

Each location contains:

- name
- visualDescription
- environmentPrompt
- defaultProps
- lighting
- cameraSuggestions

---

# 13. PROP LIBRARY

Reusable props:

- phone
- laptop
- money
- ring
- letter
- gift
- bag
- food
- car
- key
- photograph

Props can contain persistent visual descriptions for scene consistency.

---

# 14. VISUAL STORYTELLING

Avoid scenes where one stickman stands still talking for long periods.

The system should encourage frequent visual events.

Example:

Narration:

"I checked her phone."

Scene:
Character picks up phone.

Narration:

"There were 37 messages."

Scene:
Phone close-up.

Narration:

"They were all from my best friend."

Scene:
Character shocked.

Narration:

"Then I saw the photo."

Scene:
Pause + phone screen.

Narration:

"It was taken in my bedroom."

Scene:
Bedroom reveal.

Generate visual beats that support narration.

---

# 15. VISUAL PROMPT GENERATOR

Every scene should generate a production-ready image prompt.

Prompt should preserve:

- character identity
- clothing
- body proportions
- stickman style
- environment
- camera
- emotion
- lighting
- props

Use a consistent visual style configuration.

Create global:

STYLE_PROFILE

Example properties:

- stickman style
- line thickness
- background complexity
- color strategy
- facial style
- shading
- aspect ratio
- camera language

Changing STYLE_PROFILE should update future prompt generation without rewriting story logic.

---

# 16. ANIMATION PROMPT

Separate:

IMAGE_PROMPT

from:

ANIMATION_PROMPT

Animation prompt should focus on:

- character movement
- facial change
- camera movement
- object movement
- timing
- transition

Avoid mixing unnecessary visual-generation instructions into animation instructions.

---

# 17. VOICEOVER ENGINE

Generate natural American English narration.

Requirements:

- conversational
- simple vocabulary
- natural contractions
- short sentences
- spoken English rather than essay English
- emotionally appropriate
- no unnecessary exposition

Allow voice configuration:

- male/female
- age
- tone
- speed
- emotional intensity

Support future TTS provider integrations through an abstraction layer.

---

# 18. TITLE ENGINE

Generate multiple title styles:

- Curiosity
- Conflict
- Emotional
- Mystery
- Storytime
- Short Title

Avoid dishonest clickbait.

Example:

"My Best Friend Stole My Girlfriend — So I Let Him"

Instead of generic titles such as:

"An Interesting Story About Betrayal"

Store title candidates and selected title.

---

# 19. THUMBNAIL ENGINE

Generate:

- thumbnail concept
- characters
- expressions
- composition
- background
- focal point
- text
- thumbnail image prompt

Thumbnail text should generally remain short.

Examples:

SHE LIED

HE KNEW

WRONG GUY

I SAW EVERYTHING

WHAT DID I FIND?

Do not simply reproduce the video title on the thumbnail.

---

# 20. CONTENT PACKAGE

For every completed project generate a Content Package containing:

- Final Title
- Alternative Titles
- Description
- Hashtags
- Selected Hook
- Full Script
- Voiceover Script
- Characters
- Scene List
- Storyboard
- Image Prompts
- Animation Prompts
- Sound Suggestions
- Thumbnail Concept
- Thumbnail Prompt
- CTA
- Related Video Ideas

Allow export.

---

# 21. SERIES ENGINE

Winning concepts should be expandable into a series.

Example:

Successful concept:

"My Boss Fired Me on My First Day"

Generate related concepts:

"My Boss Fired the Wrong Employee"

"My Boss Stole My Idea"

"My Boss Humiliated Me in Front of Everyone"

"My Boss Didn't Know Who My Father Was"

"My Boss Replaced Me With His Nephew"

Maintain similarity in emotional trigger while avoiding simple copies.

---

# 22. SHORT → LONG EXPANSION

Allow:

Convert Short to Long Video.

Do NOT simply make narration longer.

Expand:

- character motivation
- backstory
- secondary conflicts
- foreshadowing
- failed attempts
- reveals
- emotional stakes
- consequences

Maintain the original winning hook and core premise.

---

# 23. ANALYTICS DATA MODEL

Prepare the system for YouTube performance data.

Each published video should support:

- youtubeVideoId
- publishedAt
- videoType
- contentPillar
- concept
- hookType
- title
- duration
- views
- impressions
- ctr
- averageViewDuration
- averagePercentageViewed
- likes
- comments
- subscribersGained
- geography
- trafficSources

For Shorts also support relevant metrics such as:

- viewed
- swipedAway
- engagedViews

Use nullable fields where API availability differs.

---

# 24. CONTENT LEARNING ENGINE

This is a critical feature.

The system should learn from historical content performance.

Example:

REVENGE

Average views: high
Retention: high

MYSTERY

Average views: very high
Retention: very high

MOTIVATION

Average views: low

Future idea generation should therefore increase the probability of generating Mystery/Revenge concepts.

But:

Do NOT permanently kill weak categories from small sample sizes.

Use exploration vs exploitation.

Conceptually:

70% proven patterns
20% adjacent experiments
10% completely new experiments

Make these percentages configurable.

---

# 25. PATTERN DETECTION

Analyze performance by:

- Content Pillar
- Emotion
- Character Type
- Relationship
- Conflict
- Twist Type
- Ending Type
- Hook Type
- Video Duration
- Title Pattern

Example output:

BEST PATTERNS

Mystery + Relationship
Avg retention: ...

Revenge + Workplace
Avg views: ...

Curiosity Hook
Strongest opening retention.

Use actual stored data.

Never invent analytics.

---

# 26. IDEA HISTORY & DUPLICATE DETECTION

Store previously generated and published concepts.

Before generating new ideas:

Check similarity against existing concepts.

Detect:

- same premise
- same conflict
- same twist
- same ending
- title similarity

Warn:

"High similarity to Story #127."

Allow user to continue anyway.

---

# 27. CONTENT CALENDAR

Add planning capability.

Statuses:

IDEA
SCRIPTING
STORYBOARD
PRODUCTION
READY
SCHEDULED
PUBLISHED

Views:

- Kanban
- Calendar
- List

Allow filtering by:

- format
- pillar
- status
- performance
- target market

---

# 28. PROJECT WORKSPACE

Each video should behave as a Project.

Recommended tabs:

OVERVIEW

IDEA

HOOK

SCRIPT

CHARACTERS

SCENES

STORYBOARD

VISUALS

VOICE

THUMBNAIL

METADATA

ANALYTICS

Do not put the entire workflow onto one giant screen.

---

# 29. DASHBOARD

Dashboard should answer:

"What should I create next?"

Show:

- videos currently in production
- recently published videos
- top performing pillars
- best hooks
- strongest concepts
- weak patterns
- recommended next ideas
- Shorts that may deserve Long-form expansion

The dashboard should be actionable rather than decorative.

---

# 30. AI ARCHITECTURE

Do not scatter raw AI prompts across React components.

Create a dedicated AI layer.

Example conceptual structure:

/ai
  /prompts
  /schemas
  /providers
  /services

Services may include:

IdeaService
HookService
StoryService
ScriptService
SceneService
CharacterService
VisualPromptService
AnimationPromptService
MetadataService
ThumbnailService
AnalysisService

Use structured output whenever possible.

Validate AI responses.

Handle malformed output gracefully.

---

# 31. PROMPT VERSIONING

Every important generation should store:

- promptVersion
- model
- generationSettings
- createdAt

This allows future analysis of whether prompt changes improved output.

---

# 32. REGENERATION

Do NOT design regeneration as:

"Regenerate everything."

Support granular regeneration.

Examples:

Regenerate:

- hook only
- twist only
- ending only
- scene #7
- dialogue only
- image prompt only
- title only
- thumbnail only

Preserve locked fields.

Introduce a concept such as:

LOCKED_CONTENT

so users can prevent AI from changing approved content.

---

# 33. DATABASE DESIGN

Inspect the existing database before changing anything.

Reuse existing models where appropriate.

Potential entities:

User
Channel
ContentPillar
StoryProject
StoryIdea
Character
Location
Prop
Hook
Script
ScriptSection
Scene
Asset
Thumbnail
ContentPackage
PublishedVideo
VideoAnalytics
PromptTemplate
GenerationHistory

Do not blindly create all of these tables.

Normalize only where it provides real value.

Create migrations rather than destructive schema replacement.

---

# 34. INTERNATIONAL AUDIENCE

Primary content generation should optimize for understandable international English.

Default:

American English.

Avoid:

- unnecessary regional slang
- overly complex vocabulary
- literal translation from Vietnamese
- culturally obscure references unless intentional

Stories should generally be understandable without extensive cultural context.

---

# 35. TARGET MARKET CONFIGURATION

Create target-market configuration.

Examples:

US
UK
CA
AU
GLOBAL_ENGLISH

Configuration may influence:

- vocabulary
- spelling
- cultural references
- title style
- publishing recommendations

Do NOT rely on VPN/IP manipulation as a content strategy.

---

# 36. UX PRINCIPLE

The app should reduce this:

"Give me an idea."

into:

"What content has the highest strategic priority for me to test next?"

AI should suggest.

User decides.

Important actions:

GENERATE
REGENERATE
EDIT
LOCK
APPROVE
REJECT
DUPLICATE
EXPAND
SAVE AS TEMPLATE

---

# 37. USER CONTROL

Never automatically overwrite approved content.

If a script section has been manually edited:

mark it as modified.

If user locks it:

AI cannot alter it during regeneration unless explicitly unlocked.

---

# 38. PRODUCTION DIFFICULTY

Estimate production complexity.

Example:

LOW

1 character
1 location
simple actions

MEDIUM

2–3 characters
multiple locations

HIGH

many characters
complex action
many environments

This helps choose ideas suitable for rapid production.

---

# 39. MVP PRIORITY

Do not implement everything simultaneously.

Prioritize:

## PHASE 1 — CONTENT CORE

P0:

Content Pillars

Idea Generator

Idea Scoring

Hook Generator

Short Script Generator

Long Script Generator

Structured Scenes

Project Workspace

## PHASE 2 — PRODUCTION

Characters

Location Library

Visual Prompt Generator

Animation Prompt Generator

Voiceover Script

Thumbnail Generator

Content Package

## PHASE 3 — INTELLIGENCE

Analytics

Pattern Detection

Winner Detection

Short → Long

Series Generator

Content Recommendations

## PHASE 4 — AUTOMATION

YouTube integrations

TTS

Image generation

Video generation

Publishing workflow

Do not build Phase 4 before the core content system is reliable.

---

# 40. ENGINEERING REQUIREMENTS

Follow the existing project's:

- framework
- coding style
- folder conventions
- component library
- state management
- API conventions

Prefer incremental changes.

Requirements:

- TypeScript where already used
- strong typing
- reusable components
- clear service boundaries
- schema validation
- useful error states
- loading states
- empty states
- responsive UI
- no duplicated prompt logic
- no hard-coded secrets
- no unnecessary dependencies

---

# 41. DO NOT

Do NOT:

- rewrite the whole application unnecessarily
- delete working features
- create fake analytics
- claim an AI score predicts virality
- generate hundreds of ideas without structure
- tightly couple UI to an AI provider
- store only raw AI text when structured data is needed
- place massive prompts directly inside UI components
- regenerate approved content without permission
- create unnecessary abstractions
- install packages before checking existing dependencies
- change database architecture without migrations
- break existing API contracts unnecessarily

---

# 42. IMPLEMENTATION WORKFLOW

Work iteratively.

STEP 1

Inspect repository.

STEP 2

Document existing architecture.

STEP 3

Map existing functionality to target architecture.

STEP 4

Create implementation plan.

STEP 5

Identify files to modify/create.

STEP 6

Implement P0 incrementally.

STEP 7

Run:

- typecheck
- lint
- tests
- build

Use the project's actual available commands.

STEP 8

Fix regressions.

STEP 9

Show what changed.

STEP 10

Recommend the next highest-value implementation.

Do not stop at creating a plan if the environment allows implementation.

Proceed with implementation after the audit unless a destructive or genuinely ambiguous decision requires user approval.

---

# 43. EXPECTED OUTPUT AFTER INITIAL AUDIT

Return:

## 1. CURRENT ARCHITECTURE

Explain existing system.

## 2. CURRENT CONTENT FLOW

Show:

Current flow → problems.

## 3. TARGET FLOW

Show:

Idea
→ Hook
→ Script
→ Scene
→ Production
→ Publish
→ Analytics
→ Learning

## 4. GAP ANALYSIS

Table:

Existing | Missing | Reuse | Change | Priority

## 5. DATA MODEL CHANGES

Explain proposed schema changes.

## 6. UI CHANGES

List screens/components affected.

## 7. BACKEND CHANGES

List services/APIs affected.

## 8. AI CHANGES

List prompts/services/schemas required.

## 9. IMPLEMENTATION ORDER

P0 → P1 → P2.

## 10. FILE PLAN

List files:

CREATE
MODIFY
KEEP

Then begin implementing P0.

---

# 44. CORE PRODUCT PHILOSOPHY

Always optimize the application around this feedback loop:

CREATE
↓
TEST
↓
MEASURE
↓
LEARN
↓
GENERATE BETTER CONTENT
↓
TEST AGAIN

The application should become smarter as more content performance data becomes available.

The ultimate objective is NOT:

"Generate videos with AI."

The objective is:

"Systematically discover which stickman stories an international audience wants to watch, then efficiently produce more high-quality variations of winning patterns."

Every architectural and product decision should support that objective.

---

# START NOW

Begin by inspecting the existing repository.

Do not assume its architecture.

Do not rewrite the application from scratch.

First understand what already exists, identify reusable functionality, and then implement the smallest coherent P0 upgrade that moves the product toward the Stickman Content Engine described above.