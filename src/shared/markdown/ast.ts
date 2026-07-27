import type { ImageDirective, MediaDirective } from './media';

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

export interface Table {
  type: 'table';
  alignments: Array<'center' | 'left' | 'right' | null>;
  header: InlineNode[][];
  rows: InlineNode[][][];
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
  color?: string;
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
  color?: string;
  syntax?: 'wikilink';
  children: InlineNode[];
}

export interface Image {
  type: 'image';
  url: string;
  alt: string;
  title: string | null;
}

export interface InlineImage {
  type: 'inline-image';
  directive: ImageDirective;
}

export interface Break {
  type: 'break';
}

export interface Media {
  type: 'media';
  directive: MediaDirective;
}

export interface ImageBlock {
  type: 'image-block';
  directive: ImageDirective;
}

export type BlockNode =
  | Heading
  | Paragraph
  | Blockquote
  | List
  | Code
  | Table
  | ThematicBreak
  | Media
  | ImageBlock;

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
  | InlineImage
  | Break;

export type MarkdownNode = Root | BlockNode | ListItem | InlineNode;
