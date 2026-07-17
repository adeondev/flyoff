// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProjectPagePropertiesDialog,
  type ProjectPagePropertiesDialogProps,
} from '../../src/renderer/projects/ProjectPagePropertiesDialog';
import type {
  ProjectPageNode,
  ProjectPageProperties,
} from '../../src/shared/contracts';
import { enUS, ptBR } from '../../src/shared/i18n';

const node: ProjectPageNode & { pageType: 'markdown' } = {
  kind: 'page',
  name: 'doll',
  nodeId: 'ffbf978c-43d7-4135-a3ea-f6e4e3ec76fb',
  pageType: 'markdown',
  parentId: '56ef1bfa-1355-4ba0-ac9b-b66da816006c',
};
const properties: ProjectPageProperties = {
  contentSizeBytes: 1_536,
  createdAt: '2026-07-15T12:00:00.000Z',
  diskSizeBytes: 2_048,
  locked: false,
  modifiedAt: '2026-07-16T14:30:00.000Z',
  nodeId: node.nodeId,
  pageType: 'markdown',
  passwordProtected: false,
  readOnly: false,
  revision: '1'.repeat(64),
};

function createProps(
  overrides: Partial<ProjectPagePropertiesDialogProps> = {},
): ProjectPagePropertiesDialogProps {
  return {
    loading: false,
    logicalPath: '/baby/Notas/doll',
    node,
    onChangePassword: vi.fn(),
    onClose: vi.fn(),
    onLock: vi.fn(),
    onPropertiesChange: vi.fn(),
    onProtect: vi.fn(),
    onRemovePassword: vi.fn(),
    onRetry: vi.fn(),
    onSetReadOnly: vi.fn(),
    onUnlock: vi.fn(),
    properties,
    translate: (key) => key,
    ...overrides,
  };
}

beforeEach(() => {
  document.documentElement.lang = 'en-US';
});

afterEach(() => {
  cleanup();
  document.documentElement.lang = '';
});

describe('ProjectPagePropertiesDialog', () => {
  it('provides professional labels in both supported locales', () => {
    expect(ptBR.projects.propertiesProtection).toBe('Prote\u00e7\u00e3o');
    expect(ptBR.projects.propertiesUnavailable).toBe('N\u00e3o dispon\u00edvel');
    expect(enUS.projects.propertiesProtection).toBe('Protection');
  });

  it('keeps the general fields stable while properties load or fail', () => {
    const onRetry = vi.fn();
    const initialProps = createProps({
      loading: true,
      onRetry,
      properties: undefined,
    });
    const { rerender } = render(
      <ProjectPagePropertiesDialog
        {...initialProps}
      />,
    );

    const content = document.querySelector('.project-page-properties');
    expect(content?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('doll')).toBeTruthy();
    expect(screen.getByText('/baby/Notas')).toBeTruthy();
    expect(screen.getByText('projects.propertiesMarkdownNote')).toBeTruthy();
    for (const label of [
      'projects.propertiesContentSize',
      'projects.propertiesDiskSize',
      'projects.propertiesCreated',
      'projects.propertiesModified',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText('\u2014').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('projects.loading')).toBeNull();
    expect(document.querySelector('[title]')).toBeNull();
    expect(
      screen.getByText('/baby/Notas').getAttribute('data-flyoff-tooltip'),
    ).toBe('/baby/Notas');

    rerender(
      <ProjectPagePropertiesDialog
        {...initialProps}
        loadError="Could not read properties"
        loading={false}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.propertiesRetry' }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('stages read-only until Apply and sends the current revision', async () => {
    const updated = {
      ...properties,
      readOnly: true,
      revision: '2'.repeat(64),
    };
    const onPropertiesChange = vi.fn();
    const onSetReadOnly = vi.fn(async () => ({
      ok: true as const,
      value: updated,
    }));
    render(
      <ProjectPagePropertiesDialog
        {...createProps({ onPropertiesChange, onSetReadOnly })}
      />,
    );
    expect(screen.getByText('1.5 KiB (1,536 bytes)')).toBeTruthy();
    expect(screen.getByText('2 KiB (2,048 bytes)')).toBeTruthy();

    const checkbox = screen.getByRole('checkbox', {
      name: /projects.propertiesReadOnly/,
    });
    fireEvent.click(checkbox);
    expect(onSetReadOnly).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.propertiesApply' }),
    );

    await waitFor(() =>
      expect(onSetReadOnly).toHaveBeenCalledWith(true, properties.revision),
    );
    expect(onPropertiesChange).toHaveBeenCalledWith(updated);
  });

  it('discards staged read-only on Cancel and closes with OK when unchanged', () => {
    const onClose = vi.fn();
    const onSetReadOnly = vi.fn();
    render(
      <ProjectPagePropertiesDialog
        {...createProps({ onClose, onSetReadOnly })}
      />,
    );

    fireEvent.click(
      screen.getByRole('checkbox', { name: /projects.propertiesReadOnly/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'projects.cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSetReadOnly).not.toHaveBeenCalled();

    cleanup();
    onClose.mockClear();
    render(
      <ProjectPagePropertiesDialog
        {...createProps({ onClose, onSetReadOnly })}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.propertiesOk' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSetReadOnly).not.toHaveBeenCalled();
  });

  it('validates and applies password protection immediately', async () => {
    const protectedProperties = {
      ...properties,
      passwordProtected: true,
      revision: '2'.repeat(64),
    };
    const onProtect = vi.fn(async () => ({
      ok: true as const,
      value: protectedProperties,
    }));
    const onPropertiesChange = vi.fn();
    render(
      <ProjectPagePropertiesDialog
        {...createProps({ onPropertiesChange, onProtect })}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'projects.propertiesDefinePassword',
      }),
    );
    const form = screen.getByRole('form', {
      name: 'projects.propertiesDefinePassword',
    });
    const password = screen.getByLabelText('projects.propertiesNewPassword');
    expect(password.getAttribute('type')).toBe('password');
    expect(
      screen.queryByLabelText('projects.propertiesConfirmPassword'),
    ).toBeNull();

    fireEvent.submit(form);
    expect(
      screen.getByRole('alert').textContent,
    ).toBe('projects.propertiesPasswordRequirements');
    expect(onProtect).not.toHaveBeenCalled();

    fireEvent.change(password, { target: { value: 'x' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.showPassword' }),
    );
    expect(password.getAttribute('type')).toBe('text');
    expect(
      screen
        .getByRole('button', { name: 'projects.hidePassword' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.hidePassword' }),
    );
    expect(password.getAttribute('type')).toBe('password');
    fireEvent.submit(form);
    await waitFor(() =>
      expect(onProtect).toHaveBeenCalledWith(
        'x',
        properties.revision,
      ),
    );
    expect(onPropertiesChange).toHaveBeenCalledWith(protectedProperties);
  });

  it('requires the current password to change or remove protection', async () => {
    const protectedProperties = {
      ...properties,
      passwordProtected: true,
    };
    const changedProperties = {
      ...protectedProperties,
      revision: '2'.repeat(64),
    };
    const unprotectedProperties = {
      ...properties,
      revision: '3'.repeat(64),
    };
    const onChangePassword = vi.fn(async () => ({
      ok: true as const,
      value: changedProperties,
    }));
    const onRemovePassword = vi.fn(async () => ({
      ok: true as const,
      value: unprotectedProperties,
    }));
    const { rerender } = render(
      <ProjectPagePropertiesDialog
        {...createProps({
          onChangePassword,
          onRemovePassword,
          properties: protectedProperties,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'projects.propertiesChangePassword',
      }),
    );
    let form = screen.getByRole('form', {
      name: 'projects.propertiesChangePassword',
    });
    fireEvent.change(screen.getByLabelText('projects.propertiesNewPassword'), {
      target: { value: 'n' },
    });
    fireEvent.submit(form);
    expect(
      screen.getByRole('alert').textContent,
    ).toBe('projects.propertiesCurrentPasswordRequired');

    fireEvent.change(
      screen.getByLabelText('projects.propertiesCurrentPassword'),
      { target: { value: 'current secure password' } },
    );
    fireEvent.submit(form);
    await waitFor(() =>
      expect(onChangePassword).toHaveBeenCalledWith(
        'current secure password',
        'n',
        properties.revision,
      ),
    );

    rerender(
      <ProjectPagePropertiesDialog
        {...createProps({
          onChangePassword,
          onRemovePassword,
          properties: changedProperties,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'projects.propertiesRemovePassword',
      }),
    );
    form = screen.getByRole('form', {
      name: 'projects.propertiesRemovePassword',
    });
    fireEvent.submit(form);
    expect(
      screen.getByRole('alert').textContent,
    ).toBe('projects.propertiesCurrentPasswordRequired');
    fireEvent.change(
      screen.getByLabelText('projects.propertiesCurrentPassword'),
      { target: { value: 'current secure password' } },
    );
    fireEvent.submit(form);
    await waitFor(() =>
      expect(onRemovePassword).toHaveBeenCalledWith(
        'current secure password',
        changedProperties.revision,
      ),
    );
  });

  it('unlocks and locks without exposing password values', async () => {
    const lockedProperties = {
      ...properties,
      locked: true,
      passwordProtected: true,
    };
    const onPropertiesChange = vi.fn();
    const onUnlock = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'authentication-failed' as const,
          message: 'Wrong password or damaged note',
        },
        ok: false as const,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          content: '# doll',
          nodeId: node.nodeId,
          readOnly: true,
          revision: '2'.repeat(64),
        },
      });
    const onLock = vi.fn(async () => ({ ok: true as const, value: null }));
    const { rerender } = render(
      <ProjectPagePropertiesDialog
        {...createProps({
          onPropertiesChange,
          onUnlock,
          properties: lockedProperties,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'projects.propertiesUnlock' }),
    );
    const password = screen.getByLabelText('projects.propertiesPassword');
    fireEvent.change(password, { target: { value: 'current secure password' } });
    fireEvent.submit(
      screen.getByRole('form', { name: 'projects.propertiesUnlock' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'projects.authenticationFailed',
      ),
    );
    expect(onPropertiesChange).not.toHaveBeenCalled();
    fireEvent.submit(
      screen.getByRole('form', { name: 'projects.propertiesUnlock' }),
    );
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(2));
    expect(onUnlock).toHaveBeenLastCalledWith('current secure password');
    expect(onPropertiesChange).toHaveBeenCalledWith({
      ...lockedProperties,
      locked: false,
      readOnly: true,
      revision: '2'.repeat(64),
    });

    onPropertiesChange.mockClear();
    rerender(
      <ProjectPagePropertiesDialog
        {...createProps({
          onLock,
          onPropertiesChange,
          properties: { ...lockedProperties, locked: false },
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'projects.propertiesLockNow' }),
    );
    await waitFor(() => expect(onLock).toHaveBeenCalledTimes(1));
    expect(onPropertiesChange).toHaveBeenCalledWith(lockedProperties);
    expect(document.body.textContent).not.toContain('current secure password');
  });
});
