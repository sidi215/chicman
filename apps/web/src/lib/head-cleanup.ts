/**
 * Removes markup the host adds to <head> before React hydrates it.
 *
 * Netlify inserts an HTML comment ("This site is hosted on Netlify…") after
 * `<meta charset>` in every production page on `*.netlify.app`, and it cannot
 * be turned off. React hydrates the whole document, finds a node it did not
 * render, and throws error #418, then re-renders the page on the client.
 * Removing the comment and the blank text around it before hydration fixes
 * that. React itself renders no comment or text node in <head>, so nothing of
 * ours is removed. Verified on production: #418 on every load with the
 * comment, none without it.
 *
 * Runs inline from <head> (see `ThemeInit`), where everything above it is
 * already parsed. Literal ES5 source, like `themeInitScript`.
 */
export const headCleanupScript = `(function () {
  var head = document.head;
  if (!head) return;
  var node = head.firstChild;
  while (node) {
    var next = node.nextSibling;
    if (node.nodeType === 8 || (node.nodeType === 3 && !/\\S/.test(node.nodeValue || ""))) head.removeChild(node);
    node = next;
  }
})();`;
