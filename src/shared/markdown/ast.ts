export type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;

export interface Root {
  type: 'root';
  children: BlockNode[];
}

export interface Heading {
  type: 'heading';
  depth: HeadingDepth;
  divided: boolean;
  children: InlineNode[];
}

export interface Paragraph {
  type: 'paragraph';
  children: InlineNode[];
}

export interface Blockquote {
  type: 'blockquote';
  children: BlockNode[];
}

export interface List {
  type: 'list';
  ordered: boolean;
  start: number | null;
  children: ListItem[];
}

export interface ListItem {
  type: 'listItem';
  checked: boolean | null;
  children: BlockNode[];
}

export interface Code {
  type: 'code';
  lang: string | null;
  value: string;
}

export interface ThematicBreak {
  type: 'thematicBreak';
}

export interface Text {
  type: 'text';
  value: string;
}

export interface Strong {
  type: 'strong';
  children: InlineNode[];
}

export interface Emphasis {
  type: 'emphasis';
  children: InlineNode[];
}

export interface Delete {
  type: 'delete';
  children: InlineNode[];
}

export interface Highlight {
  type: 'highlight';
  children: InlineNode[];
}

export interface ColorText {
  type: 'color';
  color: string;
  children: InlineNode[];
}

export interface InlineCode {
  type: 'inlineCode';
  value: string;
}

export interface Link {
  type: 'link';
  url: string;
  title: string | null;
  children: InlineNode[];
}

export interface Image {
  type: 'image';
  url: string;
  alt: string;
  title: string | null;
}

export interface Break {
  type: 'break';
}

export type BlockNode =
  | Heading
  | Paragraph
  | Blockquote
  | List
  | Code
  | ThematicBreak;

export type InlineNode =
  | Text
  | Strong
  | Emphasis
  | Delete
  | Highlight
  | ColorText
  | InlineCode
  | Link
  | Image
  | Break;

export type MarkdownNode = Root | BlockNode | ListItem | InlineNode;
