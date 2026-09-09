export interface StickmanContentPillar {
  id: string;
  name: string;
  vietnameseName: string;
  description: string;
  targetEmotion: string;
  targetAudience: string;
  suitableFormats: ('SHORT' | 'LONG')[];
  recommendedHooks: string[];
  commonConflicts: string[];
  possibleTwists: string[];
  possibleEndings: string[];
  colorTag: string;
}

export const INITIAL_CONTENT_PILLARS: StickmanContentPillar[] = [
  {
    id: 'betrayal',
    name: 'Betrayal & Treachery',
    vietnameseName: 'Phản bội & Đâm sau lưng',
    description: 'Deception by a close friend, partner, or colleague that shatters trust and sets up high-stakes conflict.',
    targetEmotion: 'Shock, indignation, heartbreak, anticipation of revenge',
    targetAudience: 'Teens, young adults, drama & storytime lovers',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'My best friend swore he would never touch my phone. Today I found out why.',
      'She called me broke in front of the entire school. Two weeks later, she asked for a loan.',
      'I thought she was sleeping in our bedroom. Then my ring camera sent me an alert.'
    ],
    commonConflicts: ['Cheating with best friend', 'Stealing business ideas', 'Spreading malicious rumors', 'Fake friendship for money'],
    possibleTwists: ['The victim knew about the betrayal from day one', 'The betrayer was actually being manipulated', 'The fake secret was planted to test loyalty'],
    possibleEndings: ['Sweet poetic justice', 'Reversal of fortune', 'Cold silent cutoff leaving betrayer in regret'],
    colorTag: '#ef4444'
  },
  {
    id: 'revenge',
    name: 'Calculated Revenge',
    vietnameseName: 'Báo thù thông minh',
    description: 'Protagonist quietly schemes and serves karma cold to bullies, arrogant bosses, or cheating exes.',
    targetEmotion: 'Satisfaction, suspense, triumph, dark humor',
    targetAudience: 'Universal, Reddit / ProRevenge fans',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'My boss fired me and stole my project. So I deleted the one line of code keeping the company alive.',
      'My spoiled roommate ate my labeled food every day. So I made a very special batch of brownies.',
      'They laughed when they kicked me out of the group. Five years later, I bought their company.'
    ],
    commonConflicts: ['Arrogant boss stealing credit', 'School bully humiliating weak kid', 'Landlord trying illegal eviction'],
    possibleTwists: ['The revenge plan triggers automatically through legal loophole', 'The bully begs protagonist for a job unknowingly'],
    possibleEndings: ['Total public exposure', 'Bully loses everything and faces consequences', 'Protagonist walks away untouchable'],
    colorTag: '#f97316'
  },
  {
    id: 'karma',
    name: 'Instant & Inevitable Karma',
    vietnameseName: 'Nhân quả nhãn tiền',
    description: 'Greedy, selfish, or entitled people dig their own graves without the protagonist lifting a finger.',
    targetEmotion: 'Catharsis, justice, amusement, righteous satisfaction',
    targetAudience: 'General international audience, TikTok/Shorts viewers',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'The Karen demanded I give up my first-class seat. She had no idea who was flying the plane.',
      'A rich guy keyed my beat-up car in traffic. He didn’t notice the 360-degree cameras.',
      'My entitled sister demanded all of our grandmother’s inheritance. Then the will was read.'
    ],
    commonConflicts: ['Entitled customer yelling in public', 'Gold digger dumping poor boyfriend', 'Scammer tricking elderly parent'],
    possibleTwists: ['The poor guy was actually undercover millionaire', 'The item stolen had zero value without password'],
    possibleEndings: ['Arrogant person humiliated in public', 'Legal prosecution', 'Irony strikes back at the worst moment'],
    colorTag: '#eab308'
  },
  {
    id: 'mystery',
    name: 'Unexplained Mystery',
    vietnameseName: 'Bí ẩn chưa lời giải',
    description: 'A puzzling discovery, bizarre rule, or secret that pulls the viewer into a compelling curiosity gap.',
    targetEmotion: 'Intense curiosity, suspense, dread, mindblown realization',
    targetAudience: 'Mystery buffs, ARG fans, overnight YouTube bingers',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'I found a secret door behind my bedroom closet that wasn’t on the floor plan.',
      'My late father left me a key with no address and a note saying: DO NOT TURN THIS.',
      'Every night at 3:14 AM, my Wi-Fi disconnects and a device named UNKNOWN connects.'
    ],
    commonConflicts: ['Bizarre occurrences in new apartment', 'Mysterious letters appearing with personal secrets', 'A stranger who knows everything about you'],
    possibleTwists: ['The message was from the protagonist’s future self', 'The roommate was hiding a double life', 'The house had an attic resident'],
    possibleEndings: ['Jaw-dropping revelation', 'Escaping just in time with proof', 'Cliffhanger question hook'],
    colorTag: '#8b5cf6'
  },
  {
    id: 'relationship',
    name: 'Relationship Drama & Heartbreak',
    vietnameseName: 'Drama tình cảm & Chia tay',
    description: 'Deep romantic conflicts, loyalty tests, unexpected connections, and emotional turning points.',
    targetEmotion: 'Empathy, heartache, sweet revenge, hope',
    targetAudience: 'Gen Z, young adults, romance & drama watchers',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'She said she needed space to focus on herself. I saw her on her ex’s story 2 hours later.',
      'My girlfriend wanted a break right before my birthday. I followed her to the restaurant.',
      'He thought I was just his quiet tutor. Until his billionaire father bowed to me.'
    ],
    commonConflicts: ['Hidden dating apps', 'Comparison with wealthy rival', 'Parental disapproval', 'Unreturned sacrifices'],
    possibleTwists: ['The break was planned to prepare a surprise, but went wrong', 'The rival was actually a hired actor'],
    possibleEndings: ['Rebuilding self-worth and finding better partner', 'Moving apology rejected with dignity', 'Bittersweet closure'],
    colorTag: '#ec4899'
  },
  {
    id: 'underdog',
    name: 'Underdog Rise to Glory',
    vietnameseName: 'Kẻ yếu thế vươn lên',
    description: 'The underestimated protagonist gets ridiculed, works in silence, and shocks everyone with massive success.',
    targetEmotion: 'Inspiration, hype, vindication, adrenaline',
    targetAudience: 'Gamers, coders, students, hustlers',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'They laughed when I showed them my first prototype. 6 months later, Apple offered $2M.',
      'My teacher said I would end up working minimum wage forever. Look at my tax return today.',
      'The pro gaming team kicked me out for being too slow. Today I faced them in the finals.'
    ],
    commonConflicts: ['Ridiculed by seniors', 'Rejected by top colleges/jobs', 'Overcoming physical or financial limits'],
    possibleTwists: ['Protagonist secretly built the tool the company now relies on', 'The mentor was the original founder'],
    possibleEndings: ['Stunning victory on public stage', 'Former mockers forced to ask for help', 'Humble flex'],
    colorTag: '#06b6d4'
  },
  {
    id: 'awkward_life',
    name: 'Awkward & Relatable Life',
    vietnameseName: 'Tình huống dở khóc dở cười',
    description: 'Exaggerated everyday embarrassments, social anxiety, cringe moments, and funny misunderstandings.',
    targetEmotion: 'Humor, cringe, relatable laughter, relief',
    targetAudience: 'Casual viewers, meme consumers, TikTok Shorts',
    suitableFormats: ['SHORT'],
    recommendedHooks: [
      'I waved back at a girl waving at me. She was waving at the guy behind me.',
      'I accidentally sent a screenshot of our conversation back to the person I was talking about.',
      'My boss asked why I was typing so fast on mute. I was playing a rhythm game.'
    ],
    commonConflicts: ['Screen-sharing mistakes', 'Overthinking a simple greeting', 'Accidental text to boss'],
    possibleTwists: ['The other person made an even bigger mistake', 'The boss thought it was dedication'],
    possibleEndings: ['Embarrassment turned into inside joke', 'Sneaking away unnoticed', 'Hilarious defeat'],
    colorTag: '#10b981'
  },
  {
    id: 'dark_twist',
    name: 'Dark Psychological Twist',
    vietnameseName: 'Cú lật tâm lý đen tối',
    description: 'Stories where what seemed innocent is sinister, or the narrator themselves is not who they claim.',
    targetEmotion: 'Chills, psychological shock, paranoia, awe',
    targetAudience: 'Psychological thriller & horror enthusiasts',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'I finally found the person who kept sending flowers to my girlfriend. It was her therapist.',
      'The police said my house was locked from the inside. But I was standing on the outside.',
      'My sweet elderly neighbor offered me cookies every Sunday. Then I checked my basement.'
    ],
    commonConflicts: ['Paranoia about being watched', 'Uncovering family secrets', 'Hidden camera discoveries'],
    possibleTwists: ['The victim was the orchestrator all along', 'The protagonist has memory loss', 'A simulation reveal'],
    possibleEndings: ['Unsettling realization', 'Dark justice', 'Lingering eerie silence'],
    colorTag: '#6366f1'
  },
  {
    id: 'workplace',
    name: 'Workplace Drama & Malicious Compliance',
    vietnameseName: 'Drama công sở & Trả đũa',
    description: 'Bad managers, entitled coworkers, ridiculous corporate rules, and smart employees fighting back.',
    targetEmotion: 'Righteous fury, clever satisfaction, triumph',
    targetAudience: 'Working adults, corporate escapees, Reddit /antiwork',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'My boss said: Follow the employee handbook to the exact letter. So I did. And cost him $500K.',
      'They fired me for taking a 15-minute emergency call. Now their entire database won’t boot.',
      'My coworker claimed my 3-month project was entirely her work. So I let her present it to the CEO.'
    ],
    commonConflicts: ['Stolen credit', 'Unpaid overtime demands', 'Nepotism promotions', 'Micromanagement'],
    possibleTwists: ['The employee possessed the only encryption master key', 'The client only signed because of protagonist'],
    possibleEndings: ['Boss fired or demoted by board', 'Protagonist hired by client directly with double salary'],
    colorTag: '#3b82f6'
  },
  {
    id: 'family_conflict',
    name: 'Family Inheritance & Sibling Feud',
    vietnameseName: 'Gia tộc & Thừa kế bí mật',
    description: 'Greedy relatives, favorite child syndrome, secret test of character, and unexpected will revelations.',
    targetEmotion: 'Outrage, filial justice, emotional vindication',
    targetAudience: 'Family story lovers, Asian/American drama watchers',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'My brother took all of mom’s jewelry before she passed. He didn’t read the fake gold certificate.',
      'My in-laws demanded I sell my apartment to pay for my brother-in-law’s wedding. I smiled and called a lawyer.',
      'My father pretended to lose all his fortune to see which child would let him sleep on their couch.'
    ],
    commonConflicts: ['Will reading drama', 'Unfair treatment of adopted or quiet child', 'Demanding money for reckless relatives'],
    possibleTwists: ['The battered old box was worth more than the family estate', 'The quiet caregiver was the sole heir'],
    possibleEndings: ['Greedy relatives left with empty hands', 'Honest child receives true inheritance'],
    colorTag: '#d97706'
  },
  {
    id: 'friendship',
    name: 'Fake Friends & Loyalty Broken',
    vietnameseName: 'Tình bạn giả tạo & Giác ngộ',
    description: 'The toxic friend circle that takes advantage, excludes, or abandons the protagonist at their lowest.',
    targetEmotion: 'Disappointment, awakening, empowerment, self-worth',
    targetAudience: 'High school, college students, Gen Z',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'They created a secret group chat without me. Then someone accidentally added me to it.',
      'My best friend borrowed my car for a date. The police just called me about a hit-and-run.',
      'I pretended my card declined at dinner. That was the day I realized I had zero real friends.'
    ],
    commonConflicts: ['Free-loading friends', 'Abandonment during crisis', 'Backstabbing behind smiles'],
    possibleTwists: ['The quiet acquaintance steps up as true friend', 'The secret group chat was screenshotted and leaked'],
    possibleEndings: ['Severing ties without looking back', 'Building real supportive circle', 'Karma visits the group'],
    colorTag: '#14b8a6'
  },
  {
    id: 'creepy',
    name: 'Creepy Urban Legends & Odd Rules',
    vietnameseName: 'Chuyện rùng rợn & Quy tắc kỳ bí',
    description: 'Suspicious jobs with strict lists of rules, late night deliveries, and eerie encounters.',
    targetEmotion: 'Chills, heart-racing tension, psychological fear',
    targetAudience: 'Creepypasta fans, late-night story enthusiasts',
    suitableFormats: ['SHORT', 'LONG'],
    recommendedHooks: [
      'I took a graveyard shift security job at a museum. Rule #4 said: If the mannequin blinks, RUN.',
      'My Airbnb host left a note: Do not open the basement red door, even if you hear someone crying.',
      'I bought a smart mirror at a thrift store. At midnight, my reflection moved 2 seconds before me.'
    ],
    commonConflicts: ['Violating an ancient rule', 'Escaping an uncanny situation', 'Uncovering entity origins'],
    possibleTwists: ['The monster was protecting the house from something worse', 'The rules were a test for the new caretaker'],
    possibleEndings: ['Barely surviving until sunrise', 'Solving the puzzle just in time', 'Chilling realization'],
    colorTag: '#a855f7'
  }
];

export interface StickmanStoryDimensions {
  characters: string[];
  environments: string[];
  conflicts: string[];
  twists: string[];
  endings: string[];
}

export const STORY_DIMENSIONS: StickmanStoryDimensions = {
  characters: [
    'Student', 'Tech Employee', 'Arrogant Boss', 'Boyfriend', 'Girlfriend', 'Ex-Partner',
    'Best Friend', 'Toxic Roommate', 'Karen Neighbor', 'Strict Teacher', 'Struggling Parent',
    'Greedy Sibling', 'Mysterious Stranger', 'Undercover Millionaire', 'School Bully',
    'Quiet Genius Kid', 'Doctor', 'Police Officer'
  ],
  environments: [
    'School Classroom', 'Corporate Office', 'Small Apartment', 'Family House', 'City Street',
    'Fancy Restaurant', 'Cozy Coffee Shop', 'Hospital Room', 'Airport Terminal', 'Highway in Car',
    'Summer Beach', 'Courtroom', 'Airbnb Basement', 'Luxury Hotel Lobby', 'Nightclub'
  ],
  conflicts: [
    'Cheating & Infidelity', 'Stolen Business Idea', 'Public Humiliation', 'Brutal Rejection',
    'Unfair Termination / Firing', 'Malicious Gossip & Rumors', 'Greedy Inheritance Claim',
    'Financial Exploitation', 'Identity Theft', 'Mysterious Threatening Note', 'Breach of Strict Rules'
  ],
  twists: [
    'Protagonist knew the secret from the very start', 'The accuser was the actual perpetrator',
    'Secret audio/video recording was streaming live', 'A key legal loophole reversed everything',
    'The supposed beggar was the majority owner', 'The opponent walked straight into their own trap',
    'The message came from inside the house'
  ],
  endings: [
    'Sweet Poetic Justice / Instant Karma', 'Calculated Revenge Executed Flawlessly',
    'Emotional Reconciliation & Maturity', 'Triumphant Underdog Victory',
    'Dark Psychological Mindbend', 'Silent Cutoff & Dramatic Life Upgrade'
  ]
};

export interface StickmanIdea {
  id: string;
  workingTitle: string;
  premise: string;
  pillarId: string;
  targetMarket: string;
  targetAudience: string;
  recommendedFormat: 'SHORT' | 'LONG';
  mainCharacter: string;
  supportingCharacters: string[];
  relationship: string;
  setting: string;
  conflict: string;
  emotionalTrigger: string;
  twist: string;
  ending: string;
  hook: string;
  whyItMayWork: string;
  originalityAngle: string;
  estimatedComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  score: {
    overall: number;
    hookStrength: number;
    curiosity: number;
    emotionalIntensity: number;
    relatability: number;
    twistPotential: number;
    visualPotential: number;
    seriesPotential: number;
  };
}

export interface HookVariation {
  id: string;
  type: 'SHOCK' | 'CURIOSITY' | 'DIALOGUE' | 'CONFLICT' | 'MYSTERY';
  label: string;
  text: string;
  score: number;
}

export interface ScriptBeat {
  id: string;
  timeRange: string;
  label: string;
  narration: string;
  dialogue?: string;
  action: string;
  emotion: string;
  camera: string;
  soundEffect?: string;
  locked?: boolean;
}

export interface EngineScene {
  sceneNumber: number;
  duration: number;
  location: string;
  characters: { name: string; action: string; emotion: string; outfit?: string; prop?: string }[];
  narration: string;
  dialogue?: string;
  action: string;
  emotion: string;
  camera: string;
  visualDescription: string;
  imagePrompt: string;
  animationPrompt: string;
  soundEffect?: string;
}

export interface StickmanContentPackage {
  title: string;
  alternativeTitles: string[];
  caption: string;
  description: string;
  hashtags: string[];
  selectedHook: string;
  fullScript: string;
  voiceoverScript: string;
  scenes: EngineScene[];
  thumbnailConcept: string;
  thumbnailText: string;
  thumbnailPrompt: string;
  cta: string;
  relatedVideoIdeas: string[];
}

export interface GenerateStickmanIdeasInput {
  pillarId: string;
  targetMarket?: string;
  targetAudience?: string;
  format?: 'SHORT' | 'LONG';
  desiredEmotion?: string;
  tone?: string;
  count?: number;
  seedPremise?: string;
  selectedCharacter?: string;
  selectedEnvironment?: string;
  selectedConflict?: string;
}

export interface GenerateHooksInput {
  idea: StickmanIdea;
}

export interface GenerateScriptInput {
  idea: StickmanIdea;
  selectedHook?: string;
  format?: 'SHORT' | 'LONG';
  targetMinutes?: number;
}

export interface RegenerateBeatInput {
  idea: StickmanIdea;
  beats: ScriptBeat[];
  targetBeatId: string;
  instruction?: string;
}

export interface GenerateScenesInput {
  idea: StickmanIdea;
  beats: ScriptBeat[];
}

export interface GeneratePackageInput {
  idea: StickmanIdea;
  selectedHook: string;
  beats: ScriptBeat[];
  scenes: EngineScene[];
}

export interface ExpandShortToLongInput {
  shortPackage: StickmanContentPackage;
  originalIdea: StickmanIdea;
}

export interface StudioReelEpisode {
  scriptId: string;
  title: string;
  content: string;
  caption: string;
  description: string;
  hashtags: string[];
  outputDir: string;
}
