# Architecture diagrams

Open `index.html` in a browser. Each diagram is a standalone interactive HTML page generated with [Archify](https://github.com/tt-a1i/archify) 3.2.

`sources/` holds the Archify JSON for each diagram. To regenerate one after changing it:

```bash
node <archify>/bin/archify.mjs finalize <type> sources/<name>.json diagrams/<name>.html --repo-root ../.. --quality showcase
```

Set `meta.repository.revision` to your current commit first. The checked-in sources point at the build-environment commit used when the diagrams were generated.
