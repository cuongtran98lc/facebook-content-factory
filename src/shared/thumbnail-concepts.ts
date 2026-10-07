export const THUMBNAIL_CONCEPTS = {
  PROBLEM_STATE: { label: 'Problem State', description: 'Một tình huống then chốt với 1–3 nhân vật tương tác, biểu cảm và đạo cụ theo truyện.', direction: 'One continuous scene: a large protagonist interacting with up to two story-relevant supporting characters. Show the title premise through a clear action and contrasting reactions, with one meaningful visual clue. Keep the outcome unresolved.' },
  SPLIT_SCREEN: { label: 'Split-Screen Comparison', description: 'Hai nửa đối chiếu cùng nhân vật trong hai trạng thái tương phản.', direction: 'Two scenes, left then right: compare two story-grounded states of the same protagonist. Keep identical name, hair, age and identifying outfit. Contrast expressions, props and environment. No invented outcome or spoilers.' },
  HIGH_STAKES: { label: 'High-Stakes Dilemma', description: 'Nhân vật ở giữa, hai bên là hai lựa chọn có cái giá rõ ràng.', direction: 'Three scenes in order: left choice and its visible stakes, protagonist facing the dilemma in the center, right choice and its visible stakes. Use only choices and costs supported by the story. Leave the decision unresolved. Side scenes emphasize settings and relevant objects; the central protagonist is the largest subject.' },
} as const
export type ThumbnailConcept = keyof typeof THUMBNAIL_CONCEPTS

export interface ProblemStateConceptData {
  concept: 'PROBLEM_STATE'
  actor: {
    name: string
    action?: string
    emotion?: string
    outfit?: string
    hair?: string
    role?: string
    prop?: string
  }
  setting?: string
  clue?: string
  dangerTag?: string
}

export interface SplitScreenConceptData {
  concept: 'SPLIT_SCREEN'
  leftTitle?: string
  rightTitle?: string
  leftActor: {
    name: string
    action?: string
    emotion?: string
    outfit?: string
    hair?: string
    role?: string
    prop?: string
  }
  rightActor: {
    name: string
    action?: string
    emotion?: string
    outfit?: string
    hair?: string
    role?: string
    prop?: string
  }
  leftSetting?: string
  rightSetting?: string
}

export interface HighStakesConceptData {
  concept: 'HIGH_STAKES'
  centerActor: {
    name: string
    action?: string
    emotion?: string
    outfit?: string
    hair?: string
    role?: string
    prop?: string
  }
  leftChoice: {
    title: string
    stake: string
    prop?: string
    color?: string
  }
  rightChoice: {
    title: string
    stake: string
    prop?: string
    color?: string
  }
  dilemmaQuestion?: string
}

export type StickConceptData = ProblemStateConceptData | SplitScreenConceptData | HighStakesConceptData
