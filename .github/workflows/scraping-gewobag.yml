name: Scrape Gewobag

on:
  workflow_dispatch:  # Manual trigger
  repository_dispatch:
    types: [scrape_gewobag]

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          
      - run: npm install
      
      - run: npx playwright install chromium
      
      - name: Scrape Gewobag
        run: node scraper-gewobag.js
        
      - name: Update Gewobag Gist
        run: |
          curl -X PATCH \
            -H "Authorization: token ${{ secrets.GIST_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d "{\"files\":{\"gewobag.json\":{\"content\":\"$(cat results.json | jq -c . | sed 's/\"/\\\"/g')\"}}}" \
            https://api.github.com/gists/${{ secrets.GIST_ID_GEWOBAG }}
