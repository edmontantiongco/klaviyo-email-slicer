export type EditorMode = 'select' | 'row' | 'col'
export type Zoom = 'fit' | number

export type Selection =
  | { type: 'cell'; id: string }
  | { type: 'rowcut'; rowIndex: number }
  | { type: 'colcut'; rowIndex: number; cutIndex: number }
  | null
