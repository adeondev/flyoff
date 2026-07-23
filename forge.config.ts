import path from 'node:path';

import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';

import mainConfig from './webpack.main.config';
import rendererConfig from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: {
    appBundleId: 'com.flyoff.app',
    asar: true,
    executableName: 'Flyoff',
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeExtensions: ['flyd'],
          CFBundleTypeIconFile: 'flyoff.icns',
          CFBundleTypeName: 'Flyoff Diagram File',
          CFBundleTypeRole: 'Editor',
          LSHandlerRank: 'Owner',
          LSItemContentTypes: ['com.flyoff.diagram'],
        },
      ],
      UTExportedTypeDeclarations: [
        {
          UTTypeConformsTo: ['public.json'],
          UTTypeDescription: 'Flyoff Diagram File',
          UTTypeIdentifier: 'com.flyoff.diagram',
          UTTypeTagSpecification: {
            'public.filename-extension': ['flyd'],
            'public.mime-type': 'application/vnd.flyoff.diagram',
          },
        },
      ],
    },
    extraResource: ['./public/images/twemoji', './resources/mime'],
    icon: './resources/icons/flyoff',
  },
  rebuildConfig: {},
  hooks: {
    packageAfterCopy: async (
      resolvedConfig,
      buildPath,
      _electronVersion,
      platform,
      arch,
    ) => {
      const {
        flipFuses,
        FuseV1Options,
        FuseVersion,
      } = await import('@electron/fuses');
      const isApplePlatform = platform === 'darwin' || platform === 'mas';
      const executableRoot = path.resolve(buildPath, '../..');
      const executablePath = isApplePlatform
        ? path.join(executableRoot, 'MacOS', 'Electron')
        : path.join(
            executableRoot,
            `electron${platform === 'win32' ? '.exe' : ''}`,
          );
      const osxSign = resolvedConfig.packagerConfig.osxSign;
      const hasOsxSign =
        (typeof osxSign === 'object' &&
          osxSign !== null &&
          Object.keys(osxSign).length > 0) ||
        Boolean(osxSign);

      await flipFuses(executablePath, {
        version: FuseVersion.V1,
        resetAdHocDarwinSignature:
          !hasOsxSign && isApplePlatform && arch === 'arm64',
        strictlyRequireAllFuses: true,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
        [FuseV1Options.WasmTrapHandlers]: true,
      });
    },
  },
  makers: [
    new MakerSquirrel({
      authors: 'Flyoff',
      setupIcon: './resources/icons/flyoff.ico',
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({
      options: {
        categories: ['Office', 'Utility'],
        icon: './resources/icons/flyoff.png',
        mimeType: ['application/vnd.flyoff.diagram'],
      },
    }),
    new MakerDeb({
      options: {
        categories: ['Office', 'Utility'],
        icon: './resources/icons/flyoff.png',
        mimeType: ['application/vnd.flyoff.diagram'],
        scripts: {
          postinst: './resources/linux/deb/postinst',
          postrm: './resources/linux/deb/postrm',
        },
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/main.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload/index.ts',
            },
          },
        ],
      },
    }),
  ],
};

export default config;
