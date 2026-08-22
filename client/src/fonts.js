/**
 * v2.0.00 (Step 3, FR-18) — self-hosted fonts.
 *
 * Every font family referenced anywhere in the app (index.html, PublicLayout,
 * Overlay, tablet pages, help) is bundled locally via @fontsource so ALL venue
 * pages render correctly with no internet. The Google Fonts CDN links are
 * removed; cloud mode benefits too (no external font fetch).
 *
 * Weights match the previous CDN requests:
 *   Bebas Neue 400 · DM Sans 300–700 (+400 italic) · JetBrains Mono 400/500/700
 *   Oswald 400–700 · Barlow 300–600 · Inter Tight 400–800 · Barlow Condensed 400–800
 */

import '@fontsource/bebas-neue/400.css';

import '@fontsource/dm-sans/300.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/dm-sans/400-italic.css';

import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';

import '@fontsource/oswald/400.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/600.css';
import '@fontsource/oswald/700.css';

import '@fontsource/barlow/300.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';

import '@fontsource/inter-tight/400.css';
import '@fontsource/inter-tight/500.css';
import '@fontsource/inter-tight/600.css';
import '@fontsource/inter-tight/700.css';
import '@fontsource/inter-tight/800.css';

import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
