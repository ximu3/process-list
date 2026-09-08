import manifest from './package.json' with { type: 'json' }

export default {
  '**/*.{js,mjs,cjs,ts,json,yml,yaml,md}': manifest.scripts['check:format'],
  // Cargo formats the crate; do not append individual paths as Cargo arguments.
  '**/{*.rs,Cargo.toml,rustfmt.toml}': () => manifest.scripts['check:rust-format'],
}
