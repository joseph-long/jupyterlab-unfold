# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## Fork History

This repository is a fork of `jupyterlab-unfold`.

For project history before this fork, see:

- https://github.com/jupyterlab-contrib/jupyterlab-unfold/blob/master/CHANGELOG.md

## 0.1.0 - 2026-03-22

Initial release for `jupyterlab-speedy-unfold` based on fork point `981ba040b083427ed64f1444599b44553667f650`.

### Highlights Since Fork

- Renamed and repackaged the project as `jupyterlab-speedy-unfold`.
- Added a server-side tree endpoint and timing headers to accelerate large-directory listing.
- Implemented and iterated on virtualized tree rendering performance improvements:
  - row rendering and depth/icon update optimizations
  - cached directory listing and row DOM references
  - faster sorting and CSS-based indentation
  - improved benchmark stability and reporting
- Added and expanded Playwright benchmark/integration coverage.
- Hardened drag-and-drop behavior and reduced noisy backend error logging during UI tests.
- Updated CI pipelines and release workflow metadata for the new package identity.
