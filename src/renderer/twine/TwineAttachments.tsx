import closeIcon from '../../../public/images/icons/actions/close-toolbar.svg';
import fileIcon from '../../../public/images/icons/instances/file.svg';
import { MaskedIcon } from '../components/MaskedIcon';
import { getTooltipTargetProps } from '../components/tooltip';
import type { Translate } from '../pages/page-types';
import type { TwineAttachment } from './twine-types';

interface TwineAttachmentsProps {
  attachments: readonly TwineAttachment[];
  onRemove: (id: string) => void;
  translate: Translate;
}

export function formatTwineFileSize(size: number): string {
  if (size < 1_024) {
    return `${size} B`;
  }
  if (size < 1_048_576) {
    return `${Math.ceil(size / 1_024)} KB`;
  }
  return `${(size / 1_048_576).toFixed(size < 10_485_760 ? 1 : 0)} MB`;
}

export function TwineAttachments({
  attachments,
  onRemove,
  translate,
}: TwineAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div
      aria-label={translate('twine.attachments')}
      className="twine-attachments"
      role="list"
    >
      {attachments.map((attachment) => (
        <div className="twine-attachment" key={attachment.id} role="listitem">
          {attachment.previewUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="twine-attachment__preview"
              src={attachment.previewUrl}
            />
          ) : (
            <MaskedIcon
              className="twine-attachment__file-icon"
              icon={fileIcon}
            />
          )}
          <span className="twine-attachment__details">
            <span className="twine-attachment__name">
              {attachment.file.name}
            </span>
            <span className="twine-attachment__size">
              {formatTwineFileSize(attachment.file.size)}
            </span>
          </span>
          <button
            aria-label={`${translate('twine.removeAttachment')}: ${attachment.file.name}`}
            className="twine-attachment__remove"
            onClick={() => onRemove(attachment.id)}
            type="button"
            {...getTooltipTargetProps(
              translate('twine.removeAttachment'),
              'top',
            )}
          >
            <MaskedIcon icon={closeIcon} />
          </button>
        </div>
      ))}
    </div>
  );
}
