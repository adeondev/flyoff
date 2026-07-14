{
  "targets": [
    {
      "target_name": "flyoff_native_core",
      "sources": [
        "src/addon.cpp",
        "src/core.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "include"
      ],
      "dependencies": [
        "<!(node -p \"((p) => p.join(p.dirname(require.resolve('node-addon-api')), 'node_api.gyp').split(p.sep).join('/') + ':nothing')(require('node:path'))\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/std:c++20"
                ]
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "11.0"
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "cflags_cc": [
              "-std=c++20"
            ]
          }
        ]
      ]
    }
  ]
}
