/* Old ktfcsa.com pages point here. The meta refresh in each stub does the work;
   this is the belt to its braces, because a few browsers drop the fragment on a
   meta refresh and the supporter would land on the home screen instead of the
   page the link promised. */
(function () {
  var link = document.querySelector('link[rel="canonical"]');
  if (!link) return;
  var to = link.getAttribute("href").replace(/^https?:\/\/[^/]+/, "");
  if (location.pathname + location.hash !== to) location.replace(to);
})();
