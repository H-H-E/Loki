# Loki design QA
Source visual: ../generated_images/exec-e8b641b1-0ab8-4ec9-a651-b0cb857ab52e.png (1487 x 1058).
Implementation: /workspace/scratch/loki-studio-final-1791873897768.jpg (1363 x 936, desktop browser CSS viewport).
State: Spin, light theme, invented demonstration, protected first line after an edit.
Comparison: side-by-side normalized source and browser capture in qa-captures/comparison-final.png. Different demo lyrics and additional repeated sections are intentional to exercise the PDF's functional scope. Inspector is closed in the default implementation state rather than showing generated alternatives without a request.
Findings and fixes:
- P2: primary generation controls were below the fold on long songs. Fixed with a persistent footer; recaptured with actions visible.
- P2: manuscript type was too small relative to target. Increased desktop lyrics to 20px, section labels to22px, and sized textareas to content. Recaptured with no clipped text.
Required surfaces: editorial monospace lyric feel, neutral interface typography, warm paper/carbon/mint tokens, aligned columns and generous section spacing; no invented imagery or score gauges. Icons are library icons. Copy implements the PDF rather than pretending generated examples are live service output.
Primary browser interactions tested: inline editing; Protect; reload with preserved text and lock; rehearsal next/back-to-line; export clipboard excluding original lyric body; dark/light theme.
Console: initial module-resolution error fixed by explicit TSX entry and removal of starter JSX; no current app errors. Browser-extension metadata messages remain external to the app.
Responsive CSS, 44px controls and RTL support implemented. Mobile device, screen reader and five-person singing usability checks remain unverified.
Live API/cloud verification requires configured services and the Neon/Better Auth migrations.
final result: passed


Backend migration verification: 99 automated tests passed, including embedded PostgreSQL and Better Auth session/ownership flows. Live Neon credentials were not available; production migrations were not executed.
