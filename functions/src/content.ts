import * as cheerio from "cheerio";
import marked from "marked";
import * as path from "path";
import * as url from "url";
import urljoin from "url-join";

import { RepoData, RepoPageSection } from "../../shared/types";

const BADGE_PATTERNS = [
  "travis-ci.org",
  "shields.io",
  "coveralls.io",
  "badge.fury.io",
  "gitter.im",
  "circleci.com",
  "opencollective.com",
  "cirrus-ci.com",
  "sonarcloud.io",
  "codecov.io",
  "release-notes.com",
  "awesome.re",
  /github\.com\/.*\/workflows\/.*\.svg/,
];

// TODO: Use Prism to highlight code
marked.setOptions({
  renderer: new marked.Renderer(),
  gfm: true,
  headerIds: true,
  breaks: false,
});

export function renderContent(
  product: string,
  repo: RepoData,
  page: string,
  content: string,
  branch: string
) {
  const html = marked(content);
  const sanitizedHtml = sanitizeHtml(product, repo, page, html, branch);
  const sections = htmlToSections(sanitizedHtml);

  return sections;
}

/**
 * Sanitize the content Html.
 */
function sanitizeHtml(
  product: string,
  repo: RepoData,
  page: string,
  html: string,
  branch: string
): string {
  // Links
  // * Links to page content files should go to our page
  // * Links to source files should go to github
  //
  // Images
  // * Images and other things should be made into githubusercontent links
  // * Remove badges

  // TODO: What is this!
  let pageDir = "";
  if (page) {
    const lastSlash = page.lastIndexOf("/");
    pageDir = page.substring(0, lastSlash);
    if (lastSlash >= 0) {
      pageDir = page.substring(0, lastSlash);
    }
  }

  // URL path to this project on ugc.dev
  const projectBaseUrl = `/products/${product}/repos/${repo.id}/`;

  // URL path to this project on github
  const renderedBaseUrl = `https://github.com/${repo.metadata.owner}/${repo.metadata.repo}/tree/${branch}/`;

  // URL path to this project dir on github (raw)
  const rawBaseUrl = `https://raw.githubusercontent.com/${repo.metadata.owner}/${repo.metadata.repo}/${branch}/${pageDir}`;

  // Paths to all pages within this repo
  const pagePaths = (repo.metadata.pages || []).map((page) => page.path);

  const $: cheerio.Root = cheerio.load(html);

  // Make all code sections prettyprinted
  $("pre > code").each((_: number, el: cheerio.Element) => {
    $(el).addClass("prettyprint");
  });

  // Resolve all relative links to github
  $("a").each((_: number, el: cheerio.Element) => {
    if (el.type === "text") {
      return;
    }

    const href = el.attribs["href"];
    if (!href) {
      return;
    }

    // TODO: We should handle links to github.com in addition to relative links

    if (isRelativeLink(href)) {
      // Check if the link is to a page within the repo
      const repoRelative = path.join(pageDir, href);

      console.log(`Relative link on page ${page}: ${href} --> ${repoRelative}`);
      el.attribs["href"] = repoRelative;

      const repoRelativeWithoutHash =
        repoRelative.indexOf("#") >= 0
          ? repoRelative.substring(0, repoRelative.indexOf("#"))
          : repoRelative;

      const isProjectPage = pagePaths.indexOf(repoRelativeWithoutHash) >= 0;
      if (isProjectPage) {
        modifyAttr(el, "href", (h: string) => {
          let res = h;
          res = res.toLowerCase();
          res = res.replace(/\.md/, "");
          res = sanitizeRelativeLink(res, projectBaseUrl);

          return res;
        });

        let href = el.attribs["href"];
        href = href.toLowerCase();
        href = href.replace(/\.md/, "");
        href = sanitizeRelativeLink(href, projectBaseUrl);

        console.log(
          `Sanitizing relative project link ${repoRelative} --> ${el.attribs["href"]}`
        );
      } else {
        sanitizeRelativeLink(href, renderedBaseUrl);
        console.log(
          `Sanitizing relative GitHub link ${repoRelative} --> ${el.attribs["href"]}`
        );
      }
    }
  });

  // Resolve all relative images, add class to parent
  $("img").each((_: number, el: cheerio.Element) => {
    if (el.type === "text") {
      return;
    }

    const src = el.attribs["src"];
    if (!src) {
      return;
    }

    const isBadge = BADGE_PATTERNS.some((pattern) => {
      return !!src.match(pattern);
    });

    if (isBadge) {
      // Mark Badges
      $(el).addClass("img-badge");
    } else {
      // Add the image-parent class to the parent
      $(el).parent().addClass("img-parent");
    }

    modifyAttr(el, "src", (s) => sanitizeRelativeLink(s, rawBaseUrl));
  });

  return $.html();
}

function modifyAttr(
  el: cheerio.TagElement,
  attrib: string,
  fn: (a: string) => string
) {
  const val = el.attribs[attrib];
  el.attribs[attrib] = fn(val);
}

function sanitizeRelativeLink(link: string, base: string): string {
  if (isRelativeLink(link)) {
    const newVal = urljoin(base, link);
    return newVal.toLowerCase();
  }

  return link;
}

/**
 * Determine if a link is relative.
 */
function isRelativeLink(href: string): boolean {
  const hrefUrl = url.parse(href);

  // Relative link has a pathname but not a host
  return !hrefUrl.host && !!hrefUrl.pathname;
}

/**
 * Turn HTML into a sections objects.
 */
function htmlToSections(html: string): RepoPageSection[] {
  const $ = cheerio.load(html);
  const sections: RepoPageSection[] = [];

  let $headerChildren = $("div", "<div></div>");

  let $h1 = $("h1").first();
  $h1.nextUntil("h2").each((_: number, el: any) => {
    $headerChildren = $headerChildren.append(el);
  });

  // The first section is the header
  const header = {
    name: $h1.text(),
    content: $headerChildren.html()!,
  };
  sections.push(header);

  $("h2").each((_: number, el: cheerio.Element) => {
    let $sibchils = $("div", "<div></div>");

    $(el)
      .nextUntil("h2")
      .each((_: number, el: any) => {
        $sibchils = $sibchils.append(el);
      });

    sections.push({
      name: $(el).text(),
      content: $sibchils.html()!,
    });
  });

  return sections;
}