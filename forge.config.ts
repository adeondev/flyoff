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
    extraResource: ['./public/images/twemoji'],
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
    }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
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
