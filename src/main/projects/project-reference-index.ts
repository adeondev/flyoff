import path from 'node:path';

import {
  normalizeProjectSearchText,
  parseProjectSearchQuery,
  type ProjectSearchClause,
} from '../../shared/project-search';
import {
  extractMarkdownStructure,
  markdownHeadingSlug,
  normalizeInternalLinkText,
  type InternalLinkOccurrence,
  type InternalLinkSyntax,
  type MarkdownHeadingOccurrence,
} from '../../shared/markdown';
import type {
  MarkdownDocument,
  ProjectBacklinksOutcome,
  ProjectGraphSnapshot,
  ProjectInternalLinkRequest,
  ProjectInternalLinkResolution,
  ProjectInternalLinkTarget,
  ProjectLinkTarget,
  ProjectReference,
  ProjectSearchOutcome,
  ProjectSearchPreview,
  ProjectSearchRequest,
  ProjectTreeNode,
} from '../../shared/contracts';
import { ProjectOperationError } from './errors';
import type { ProjectRepository } from './project-repository';

interface IndexedDocument {
  content: string;
  headings: readonly MarkdownHeadingOccurrence[];
  links: readonly InternalLinkOccurrence[];
  readOnly: boolean;
  revision: string;
}

interface ProjectReferenceIndexOptions {
  readMarkdown: (nodeId: string) => Promise<MarkdownDocument>;
  repository: ProjectRepository;
}

interface ResolvedPath {
  candidates: readonly ProjectLinkTarget[];
}

const MARKDOWN_EXTENSION = /\.md$/i;

function includesTerms(value: string, terms: readonly string[]): boolean {
  const normalized = normalizeProjectSearchText(value);
  return terms.every((term) =>
    normalized.includes(normalizeProjectSearchText(term)),
  );
}

function markdownLines(content: string): readonly string[] {
  return content.replaceAll('\r\n', '\n').split('\n');
}

function markdownSections(content: string): readonly string[] {
  const lines = markdownLines(content);
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    return match ? [{ depth: match[1]!.length, index }] : [];
  });
  if (headings.length === 0) {
    return [content];
  }

  const sections: string[] = [];
  if (headings[0]!.index > 0) {
    sections.push(lines.slice(0, headings[0]!.index).join('\n'));
  }
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const next = headings
      .slice(index + 1)
      .find((candidate) => candidate.depth <= heading.depth);
    sections.push(
      lines.slice(heading.index, next?.index ?? lines.length).join('\n'),
    );
  }
  return sections;
}

function markdownTags(content: string): ReadonlySet<string> {
  const tags = new Set<string>();
  let fenced = false;
  for (const line of markdownLines(content)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }
    const searchable = line.replace(/`[^`]*`/gu, '');
    for (const match of searchable.matchAll(
      /(^|[\s([{>])#([\p{L}\p{N}_/-]+)/gu,
    )) {
      tags.add(normalizeProjectSearchText(match[2]!));
    }
  }
  return tags;
}

function markdownProperties(content: string): ReadonlyMap<string, string> {
  const lines = markdownLines(content);
  const properties = new Map<string, string>();
  if (lines[0]?.trim() !== '---') {
    return properties;
  }

  let currentKey: string | undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '---') {
      break;
    }
    const property = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/u.exec(line);
    if (property) {
      currentKey = normalizeProjectSearchText(property[1]!);
      properties.set(currentKey, property[2]!.trim());
      continue;
    }
    const item = /^\s*-\s+(.+)$/u.exec(line);
    if (item && currentKey) {
      properties.set(
        currentKey,
        `${properties.get(currentKey) ?? ''} ${item[1]}`.trim(),
      );
    }
  }
  return properties;
}

function contentClause(clause: ProjectSearchClause): boolean {
  return !['path', 'file'].includes(clause.kind);
}

function matchesClause(
  clause: ProjectSearchClause,
  name: string,
  projectPath: string,
  content: string | undefined,
): boolean {
  if (clause.kind === 'path') {
    return includesTerms(projectPath, clause.terms);
  }
  if (clause.kind === 'file') {
    return includesTerms(name, clause.terms);
  }
  if (clause.kind === 'text') {
    return includesTerms(
      `${name}\n${projectPath}${content === undefined ? '' : `\n${content}`}`,
      clause.terms,
    );
  }
  if (content === undefined) {
    return false;
  }
  if (clause.kind === 'tag') {
    const tags = markdownTags(content);
    return clause.terms.every((term) =>
      tags.has(normalizeProjectSearchText(term).replace(/^#/u, '')),
    );
  }
  if (clause.kind === 'line') {
    return markdownLines(content).some((line) =>
      includesTerms(line, clause.terms),
    );
  }
  if (clause.kind === 'section') {
    return markdownSections(content).some((section) =>
      includesTerms(section, clause.terms),
    );
  }

  if (clause.kind === 'property') {
    const value = markdownProperties(content).get(
      normalizeProjectSearchText(clause.name),
    );
    return (
      value !== undefined &&
      (clause.terms.length === 0 || includesTerms(value, clause.terms))
    );
  }
  return false;
}

function withoutMarkdownExtension(value: string): string {
  return value.replace(MARKDOWN_EXTENSION, '');
}

function comparePath(value: string): string {
  return withoutMarkdownExtension(value)
    .normalize('NFC')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .toLocaleLowerCase();
}

function targetPath(repository: ProjectRepository, nodeId: string): string {
  return withoutMarkdownExtension(repository.projectRelativePath(nodeId));
}

function pageTargets(repository: ProjectRepository): ProjectLinkTarget[] {
  return repository
    .listIndexedNodes()
    .filter(
      (node): node is Extract<ProjectTreeNode, { kind: 'page' }> =>
        node.kind === 'page' && node.pageType === 'markdown',
    )
    .map((node) => ({
      name: node.name,
      nodeId: node.nodeId,
      path: targetPath(repository, node.nodeId),
    }))
    .sort((left, right) =>
      left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }),
    );
}

function normalizedRelativePath(
  sourcePath: string,
  requestedPath: string,
  syntax: InternalLinkSyntax,
): string | null {
  if (!requestedPath) {
    return comparePath(sourcePath);
  }

  const clean = requestedPath.replaceAll('\\', '/');
  const sourceDirectory = path.posix.dirname(sourcePath);
  let candidate: string;
  if (syntax === 'markdown') {
    candidate = clean.startsWith('/')
      ? clean.slice(1)
      : path.posix.join(sourceDirectory, clean);
  } else if (clean.includes('/')) {
    candidate = clean.replace(/^\/+/, '');
  } else {
    return null;
  }

  const normalized = path.posix.normalize(candidate);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return comparePath(normalized);
}

function matchingHeading(
  headings: readonly MarkdownHeadingOccurrence[],
  requested: readonly string[],
): MarkdownHeadingOccurrence | undefined {
  if (requested.length === 0) {
    return undefined;
  }

  const normalized = requested.map(normalizeInternalLinkText);
  const exact = headings.find((heading) => {
    const suffix = heading.path.slice(-normalized.length);
    return (
      suffix.length === normalized.length &&
      suffix.every(
        (part, index) =>
          normalizeInternalLinkText(part) === normalized[index],
      )
    );
  });
  if (exact) {
    return exact;
  }

  if (requested.length === 1) {
    const slug = markdownHeadingSlug(requested[0]!);
    return headings.find((heading) => markdownHeadingSlug(heading.text) === slug);
  }
  return undefined;
}

function excerptAt(content: string, line: number): string {
  const value = content.split('\n')[Math.max(0, line - 1)]?.trim() ?? '';
  return value.length <= 240 ? value : `${value.slice(0, 237)}…`;
}

function previewTerms(clauses: readonly ProjectSearchClause[]): readonly string[] {
  return [
    ...new Set(
      clauses.flatMap((clause) => {
        if (clause.kind === 'path' || clause.kind === 'file') {
          return [];
        }
        return clause.kind === 'property'
          ? [clause.name, ...clause.terms]
          : clause.terms;
      }),
    ),
  ];
}

function searchPreview(
  nodeId: string,
  content: string,
  clauses: readonly ProjectSearchClause[],
): ProjectSearchPreview | undefined {
  const terms = previewTerms(clauses)
    .map(normalizeProjectSearchText)
    .filter(Boolean);
  if (terms.length === 0) {
    return undefined;
  }

  let bestLine = 0;
  let bestScore = 0;
  const lines = markdownLines(content);
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = normalizeProjectSearchText(lines[index]!);
    const score = terms.reduce(
      (total, term) => total + (normalized.includes(term) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestLine = index + 1;
      bestScore = score;
    }
  }
  if (bestScore === 0) {
    return undefined;
  }

  const excerpt = excerptAt(content.replaceAll('\r\n', '\n'), bestLine);
  return excerpt ? { excerpt, line: bestLine, nodeId } : undefined;
}

export class ProjectReferenceIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly lockedNodeIds = new Set<string>();
  private readonly readMarkdown: ProjectReferenceIndexOptions['readMarkdown'];
  private readonly repository: ProjectRepository;
  private loaded = false;

  constructor({ readMarkdown, repository }: ProjectReferenceIndexOptions) {
    this.readMarkdown = readMarkdown;
    this.repository = repository;
  }

  clear(): void {
    this.documents.clear();
    this.lockedNodeIds.clear();
    this.loaded = false;
  }

  clearNode(nodeId: string): void {
    this.documents.delete(nodeId);
    this.lockedNodeIds.add(nodeId);
    this.loaded = false;
  }

  invalidate(): void {
    this.loaded = false;
  }

  update(document: MarkdownDocument): void {
    const structure = extractMarkdownStructure(document.content);
    this.documents.set(document.nodeId, {
      content: document.content,
      headings: structure.headings,
      links: structure.links,
      readOnly: document.readOnly,
      revision: document.revision,
    });
    this.lockedNodeIds.delete(document.nodeId);
  }

  listTargets(): readonly ProjectLinkTarget[] {
    return pageTargets(this.repository);
  }

  async graph(): Promise<ProjectGraphSnapshot> {
    await this.ensureLoaded();
    const targets = new Map(
      pageTargets(this.repository).map((target) => [target.nodeId, target]),
    );
    const visibleNodeIds = new Set(this.documents.keys());
    const edgeWeights = new Map<string, number>();

    for (const [sourceNodeId, document] of this.documents) {
      for (const link of document.links) {
        const targetNodeId = this.resolveTargetNodeId(sourceNodeId, link);
        if (
          !targetNodeId ||
          targetNodeId === sourceNodeId ||
          !visibleNodeIds.has(targetNodeId)
        ) {
          continue;
        }
        const [source, target] =
          sourceNodeId.localeCompare(targetNodeId) <= 0
            ? [sourceNodeId, targetNodeId]
            : [targetNodeId, sourceNodeId];
        const key = `${source}\u0000${target}`;
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
      }
    }

    const connectionCounts = new Map<string, number>();
    const edges = [...edgeWeights].map(([key, weight]) => {
      const [sourceNodeId, targetNodeId] = key.split('\u0000') as [
        string,
        string,
      ];
      connectionCounts.set(
        sourceNodeId,
        (connectionCounts.get(sourceNodeId) ?? 0) + weight,
      );
      connectionCounts.set(
        targetNodeId,
        (connectionCounts.get(targetNodeId) ?? 0) + weight,
      );
      return { sourceNodeId, targetNodeId, weight };
    });

    const nodes = [...visibleNodeIds].flatMap((nodeId) => {
      const target = targets.get(nodeId);
      return target
        ? [
            {
              ...target,
              connectionCount: connectionCounts.get(nodeId) ?? 0,
            },
          ]
        : [];
    });
    nodes.sort((left, right) =>
      left.path.localeCompare(right.path, undefined, {
        sensitivity: 'base',
      }),
    );
    edges.sort(
      (left, right) =>
        left.sourceNodeId.localeCompare(right.sourceNodeId) ||
        left.targetNodeId.localeCompare(right.targetNodeId),
    );
    return { edges, nodes };
  }

  async resolve(
    request: ProjectInternalLinkRequest,
  ): Promise<ProjectInternalLinkResolution> {
    await this.ensureLoaded();
    const resolved = this.resolvePath(
      request.sourceNodeId,
      request.path,
      request.syntax,
    );
    if (resolved.candidates.length === 0) {
      return { status: 'missing' };
    }
    if (resolved.candidates.length > 1) {
      return {
        status: 'ambiguous',
        candidates: resolved.candidates,
      };
    }

    const candidate = resolved.candidates[0]!;
    const indexed = this.documents.get(candidate.nodeId);
    const heading = indexed
      ? matchingHeading(indexed.headings, request.headingPath)
      : undefined;
    if (
      request.headingPath.length > 0 &&
      indexed &&
      !heading
    ) {
      return { status: 'missing' };
    }
    const target: ProjectInternalLinkTarget = {
      ...candidate,
      locked: this.lockedNodeIds.has(candidate.nodeId),
      ...(heading
        ? {
            heading: {
              line: heading.line,
              offset: heading.offset,
              path: heading.path,
            },
          }
        : {}),
    };
    return { status: 'resolved', target };
  }

  async backlinks(targetNodeId: string): Promise<ProjectBacklinksOutcome> {
    await this.ensureLoaded();
    const references: ProjectReference[] = [];

    for (const [sourceNodeId, document] of this.documents) {
      const source = this.linkTarget(sourceNodeId);
      if (!source) {
        continue;
      }
      for (const link of document.links) {
        const resolution = this.resolvePath(
          sourceNodeId,
          link.path,
          link.syntax,
        );
        if (
          resolution.candidates.length !== 1 ||
          resolution.candidates[0]?.nodeId !== targetNodeId
        ) {
          continue;
        }
        references.push({
          column: link.column,
          end: link.end,
          excerpt: excerptAt(document.content, link.line),
          line: link.line,
          sourceName: source.name,
          sourceNodeId,
          sourcePath: source.path,
          start: link.start,
        });
      }
    }

    references.sort(
      (left, right) =>
        left.sourcePath.localeCompare(right.sourcePath, undefined, {
          sensitivity: 'base',
        }) || left.start - right.start,
    );
    return {
      references,
      skippedLockedNodeIds: [...this.lockedNodeIds],
    };
  }

  async search(request: ProjectSearchRequest): Promise<ProjectSearchOutcome> {
    const clauses = parseProjectSearchQuery(request.query);
    const searchesContent = clauses.some(contentClause);
    if (searchesContent) {
      await this.ensureLoaded();
    }
    const targets = pageTargets(this.repository);
    const matches = targets
      .filter((target) => {
        const document = this.documents.get(target.nodeId);
        return clauses.every((clause) =>
          matchesClause(
            clause,
            target.name,
            target.path,
            document?.content,
          ),
        );
      });
    const nodeIds = matches.map(({ nodeId }) => nodeId);
    const previews = matches.flatMap(({ nodeId }) => {
      const document = this.documents.get(nodeId);
      const preview = document
        ? searchPreview(nodeId, document.content, clauses)
        : undefined;
      return preview ? [preview] : [];
    });
    return {
      nodeIds,
      previews,
      skippedLockedNodeIds: searchesContent ? [...this.lockedNodeIds] : [],
    };
  }

  document(nodeId: string): IndexedDocument | undefined {
    return this.documents.get(nodeId);
  }

  indexedDocuments(): readonly {
    document: IndexedDocument;
    nodeId: string;
  }[] {
    return [...this.documents].map(([nodeId, document]) => ({
      document,
      nodeId,
    }));
  }

  resolveTargetNodeId(
    sourceNodeId: string,
    link: Pick<InternalLinkOccurrence, 'path' | 'syntax'>,
  ): string | undefined {
    const resolution = this.resolvePath(
      sourceNodeId,
      link.path,
      link.syntax,
    );
    return resolution.candidates.length === 1
      ? resolution.candidates[0]?.nodeId
      : undefined;
  }

  lockedNodes(): readonly string[] {
    return [...this.lockedNodeIds];
  }

  async ensureAvailable(): Promise<void> {
    await this.ensureLoaded();
  }

  referencesTo(targetNodeId: string): readonly {
    document: IndexedDocument;
    link: InternalLinkOccurrence;
    sourceNodeId: string;
  }[] {
    const references: {
      document: IndexedDocument;
      link: InternalLinkOccurrence;
      sourceNodeId: string;
    }[] = [];
    for (const [sourceNodeId, document] of this.documents) {
      for (const link of document.links) {
        const resolution = this.resolvePath(
          sourceNodeId,
          link.path,
          link.syntax,
        );
        if (
          resolution.candidates.length === 1 &&
          resolution.candidates[0]?.nodeId === targetNodeId
        ) {
          references.push({ document, link, sourceNodeId });
        }
      }
    }
    return references;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const targets = pageTargets(this.repository);
    const currentNodeIds = new Set(targets.map(({ nodeId }) => nodeId));
    for (const nodeId of this.documents.keys()) {
      if (!currentNodeIds.has(nodeId)) {
        this.documents.delete(nodeId);
      }
    }
    for (const nodeId of this.lockedNodeIds) {
      if (!currentNodeIds.has(nodeId)) {
        this.lockedNodeIds.delete(nodeId);
      }
    }

    for (const { nodeId } of targets) {
      try {
        const document = await this.readMarkdown(nodeId);
        if (this.documents.get(nodeId)?.revision !== document.revision) {
          this.update(document);
        }
      } catch (error) {
        if (
          error instanceof ProjectOperationError &&
          error.code === 'password-required'
        ) {
          this.clearNode(nodeId);
          continue;
        }
        throw error;
      }
    }
    this.loaded = true;
  }

  private linkTarget(nodeId: string): ProjectLinkTarget | undefined {
    return pageTargets(this.repository).find(
      (candidate) => candidate.nodeId === nodeId,
    );
  }

  private resolvePath(
    sourceNodeId: string,
    requestedPath: string,
    syntax: InternalLinkSyntax,
  ): ResolvedPath {
    const targets = pageTargets(this.repository);
    const sourcePath = this.repository.projectRelativePath(sourceNodeId);

    if (!requestedPath) {
      return {
        candidates: targets.filter(({ nodeId }) => nodeId === sourceNodeId),
      };
    }

    const normalized = normalizedRelativePath(
      sourcePath,
      requestedPath,
      syntax,
    );
    if (normalized !== null) {
      return {
        candidates: targets.filter(
          (candidate) => comparePath(candidate.path) === normalized,
        ),
      };
    }

    if (syntax !== 'wikilink' || requestedPath.includes('/')) {
      return { candidates: [] };
    }
    const name = normalizeInternalLinkText(
      withoutMarkdownExtension(requestedPath),
    );
    return {
      candidates: targets.filter(
        (candidate) => normalizeInternalLinkText(candidate.name) === name,
      ),
    };
  }
}
