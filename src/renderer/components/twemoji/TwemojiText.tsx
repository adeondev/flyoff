import { Fragment, memo, useState } from 'react';

import { twemojiAssetUrl, twemojiSegments } from './twemoji';

export interface TwemojiGlyphProps {
  codepoint: string;
  emoji: string;
  source?: boolean;
}

export const TwemojiGlyph = memo(function TwemojiGlyph({
  codepoint,
  emoji,
  source = false,
}: TwemojiGlyphProps) {
  const [assetFailed, setAssetFailed] = useState(false);
  const assetUrl = twemojiAssetUrl(codepoint);
  const fallback = assetFailed || !assetUrl;

  return (
    <span
      aria-label={emoji}
      className={`twemoji${source ? ' twemoji--source' : ''}${
        fallback ? ' twemoji--fallback' : ''
      }`}
      data-twemoji={codepoint}
      role="img"
    >
      <span aria-hidden="true" className="twemoji__unicode">
        {emoji}
      </span>
      {!fallback ? (
        <img
          alt=""
          aria-hidden="true"
          className="twemoji__glyph"
          contentEditable={false}
          data-md-decoration={source ? '' : undefined}
          decoding="async"
          draggable={false}
          loading="lazy"
          onError={() => setAssetFailed(true)}
          src={assetUrl}
        />
      ) : null}
    </span>
  );
});

export interface TwemojiTextProps {
  className?: string;
  text: string;
}

export const TwemojiText = memo(function TwemojiText({
  className,
  text,
}: TwemojiTextProps) {
  const content = twemojiSegments(text).map((segment, index) =>
    segment.codepoint && segment.emoji ? (
      <TwemojiGlyph
        codepoint={segment.codepoint}
        emoji={segment.emoji}
        key={`${segment.codepoint}:${index}`}
      />
    ) : (
      <Fragment key={index}>{segment.text}</Fragment>
    ),
  );
  return className ? <span className={className}>{content}</span> : content;
});
