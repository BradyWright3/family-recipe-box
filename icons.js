const paths = {
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2ZM8 6h8M8 10h5',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z',
  video: 'M3 5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm14 4 5-3v12l-5-3',
  lock: 'M6 10h12a2 2 0 0 1 2 2v8H4v-8a2 2 0 0 1 2-2Zm2 0V6a4 4 0 1 1 8 0v4m-4 4v2',
  search: 'M21 21l-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  back: 'M19 12H5m7 7-7-7 7-7',
  arrow: 'M5 12h14m-7-7 7 7-7 7',
  external: 'M13 5h6v6m0-6-9 9m8 0v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
  link: 'M10 13a4 4 0 0 0 6 .4l4-4a4 4 0 0 0-5.7-5.7l-2.3 2.3m2 5a4 4 0 0 0-6-.4l-4 4a4 4 0 0 0 5.7 5.7l2.3-2.3',
  dish: 'M3 17h18M5 15a7 7 0 0 1 14 0M12 8V6m-6 14h12',
  leaf: 'M20 4c-5.5 0-12 1.6-14 6.1a5.7 5.7 0 0 0 7.9 7.2C18.4 15.1 20 9.2 20 4ZM4 20l10-10',
  sun: 'M3 19h18m-15-3a6 6 0 0 1 12 0M12 3v3M3 14h2m14 0h2M5 7l2 2m10 0 2-2',
  bowl: 'M3 12h18a8.5 8.5 0 0 1-9 7.5A8.5 8.5 0 0 1 3 12Zm6-4 1-3m3 3 1-3m3 3 1-3',
  cake: 'M3 20h18M5 20v-8h14v8M5 15c1.5 0 1.5 1.5 3.5 1.5S10.5 15 12 15s2 1.5 3.5 1.5S17 15 19 15m-7-3V8m0-4c-2 2-2 3 0 4 2-1 2-2 0-4Z',
  bread: 'M6 19v-6a3 3 0 0 1-1-4.8c1.4-2 4-3.2 7-3.2s5.6 1.2 7 3.2a3 3 0 0 1-1 4.8v6H6Zm3-8 2-2m2 2 2-2',
  bookmark: 'M6 4h12v16l-6-4-6 4V4Zm6 4v3m0 2h.01',
  play: 'm9 5 11 7-11 7V5Z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 16h2',
  check: 'm5 12 4 4 10-10',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4'
};

export function icon(name, className = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon ' + className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}
