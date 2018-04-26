import gulp     from 'gulp';
import plugins  from 'gulp-load-plugins';
import browser  from 'browser-sync';
import rimraf   from 'rimraf';
import panini   from 'panini';
import yargs    from 'yargs';
import lazypipe from 'lazypipe';
import inky     from 'inky';
import fs       from 'fs';
import siphon   from 'siphon-media-query';
import path     from 'path';
import merge    from 'merge-stream';
import beep     from 'beepbeep';
import colors   from 'colors';
import jr       from 'gulp-json-replace';
import prettify from 'gulp-html-prettify';

const $ = plugins();

// Look for the --production flag
const PRODUCTION = !!(yargs.argv.production);

// Declar var so that both AWS and Litmus task can use it.
var CONFIG;

// Build the "dist" folder by running all of the above tasks
gulp.task('build',
  gulp.series(clean, pages, sass, images, fonts, inline, jsonReplace));

// Build emails, run the server, and watch for file changes
gulp.task('default',
  gulp.series('build', server, watch));

gulp.task('prod',
  gulp.series('build', cleanProd, buildProd));

gulp.task('zip',
  gulp.series('build', zip));

// Delete the "prod" folder
function cleanProd(done) {
  rimraf('prod', done);
}

function buildProd() {
  return gulp.src('dist/**/*')
    .pipe($.replace('static/', '{{ HOSTNAME_PROTOCOL }}/static/'))
    .pipe($.replace('<!-- <language> -->', '{% load static %}{% load i18n %}{% if not LANGUAGE_CODE %} {% get_current_language as LANGUAGE_CODE %}{% endif %}'))
    .pipe(gulp.dest('./prod'));
}

// Delete the "dist" folder
// This happens every time a build starts
function clean(done) {
  rimraf('dist', done);
}

// Compile layouts, pages, and partials into flat HTML files
// Then parse using Inky templates
function pages() {
  return gulp.src('src/pages/**/*.html')
    .pipe(panini({
      root: 'src/pages',
      layouts: 'src/layouts',
      partials: 'src/partials',
      helpers: 'src/helpers'
    }))
    .pipe(inky())
    .pipe(prettify({indent_char: ' ', indent_size: 2}))
    .pipe(gulp.dest('dist'));
}

function jsonReplace() {
  var configDev = {
    src: './configDev.json'
  };
  var configProd = {
    src: './configProd.json'
  };
  return gulp.src('./dist/*.html')
    .pipe($.if(PRODUCTION, jr(configProd), jr(configDev)))
    .pipe(gulp.dest('./dist/'));
}

// Reset Panini's cache of layouts and partials
function resetPages(done) {
  panini.refresh();
  done();
}

// Compile Sass into CSS
function sass() {
  return gulp.src('src/static/emails/scss/app.scss')
    .pipe($.if(!PRODUCTION, $.sourcemaps.init()))
    .pipe($.sass({
      includePaths: ['node_modules/foundation-emails/scss']
    }).on('error', $.sass.logError))
    .pipe($.if(!PRODUCTION, $.sourcemaps.write()))
    .pipe(gulp.dest('dist/static/emails/css'));
}

// Copy and compress images
function images() {
  return gulp.src('src/static/emails/images/**/*')
    .pipe($.imagemin())
    .pipe(gulp.dest('./dist/static/emails/images'));
}

// Copy fonts
function fonts() {
  return gulp.src('src/static/emails/fonts/**/*')
    .pipe(gulp.dest('./dist/static/emails/fonts'));
}

// Inline CSS
function inline() {
  return gulp.src('dist/**/*.html')
    .pipe($.if(PRODUCTION, inliner('dist/static/emails/css/app.css')))
    .pipe(gulp.dest('dist'));
}

// Start a server with LiveReload to preview the site in
function server(done) {
  browser.init({
    server: 'dist'
  });
  done();
}

// Watch for file changes
function watch() {
  gulp.watch('./configDev.json').on('change', gulp.series(resetPages, pages, inline, jsonReplace, browser.reload));
  gulp.watch('src/pages/**/*.html').on('change', gulp.series(pages, inline, jsonReplace, browser.reload));
  gulp.watch(['src/layouts/**/*', 'src/partials/**/*']).on('change', gulp.series(resetPages, pages, inline, jsonReplace, browser.reload));
  gulp.watch('src/static/emails/scss/**/*.scss').on('change', gulp.series(resetPages, sass, pages, inline, jsonReplace, browser.reload));
  gulp.watch('src/static/emails/images/**/*').on('change', gulp.series(images, browser.reload));
}

// Inlines CSS into HTML, adds media query CSS into the <style> tag of the email
function inliner(css) {
  var css = fs.readFileSync(css).toString();
  var mqCss = siphon(css);

  var pipe = lazypipe()
    .pipe($.inlineCss, {
      applyStyleTags: false,
      removeStyleTags: false,
      removeLinkTags: false
    })
    .pipe($.replace, '<!-- <style> -->', `<style>${mqCss}</style>`)
    .pipe($.replace, '<link rel="stylesheet" type="text/css" href="static/emails/css/app.css">', '');

  return pipe();
}

// Copy and compress into Zip
function zip() {
  var dist = 'dist';
  var ext = '.html';

  function getHtmlFiles(dir) {
    return fs.readdirSync(dir)
      .filter(function(file) {
        var fileExt = path.join(dir, file);
        var isHtml = path.extname(fileExt) == ext;
        return fs.statSync(fileExt).isFile() && isHtml;
      });
  }

  var htmlFiles = getHtmlFiles(dist);

  var moveTasks = htmlFiles.map(function(file){
    var sourcePath = path.join(dist, file);
    var fileName = path.basename(sourcePath, ext);

    var moveHTML = gulp.src(sourcePath)
      .pipe($.rename(function (path) {
        path.dirname = fileName;
        return path;
      }));

    var moveImages = gulp.src(sourcePath)
      .pipe($.htmlSrc({ selector: 'img'}))
      .pipe($.rename(function (path) {
        path.dirname = fileName + '/static/emails/img';
        return path;
      }));

    return merge(moveHTML, moveImages)
      .pipe($.zip(fileName+ '.zip'))
      .pipe(gulp.dest('dist'));
  });

  return merge(moveTasks);
}


