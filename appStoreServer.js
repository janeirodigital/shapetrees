/* simple static server
 *
 * invocation: require('./appStoreServer').init(conf)
 *   @param conf - an optional config like:
 *     {
 *       "name": "MyAppStore",
 *       "description": "my app store static content",
 *       "bin": "appStoreServer.js",
 *       "documentRoot": "myTests/staticContent"
 *     }
 *     defaults to parsing ./servers.json and finding name === 'AppStore;
 * N.B. typical express apps are started without an init().
 */

const createError = require('http-errors');
const express = require('express');
const Debug = require('debug')('blueprints:AppStore');
// const serveIndex = require('serve-index');
const fs = require('fs');
const Path = require('path');

const appStoreServer = express();
appStoreServer.configure = (confP) => {
  /* istanbul ignore next */
  const conf = confP ? confP : JSON.parse(fs.readFileSync('./servers.json', 'utf-8')).find(
    conf => conf.name === "AppStore"
  );
  const rootPath = Path.normalize(Path.resolve(conf.documentRoot) + Path.sep);

  appStoreServer.use(require('serve-favicon')('favicon.ico'));
  // appStoreServer.use(require('morgan')('dev'));
  // appStoreServer.use(serveIndex(conf.documentRoot, {'icons': true}));

  appStoreServer.use(async function (req, res, next) {
    Debug(req.method, req.originalUrl)
    // copy serve-index/index.js to force JSON output
    /* istanbul ignore next */ if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 'OPTIONS' === req.method ? 200 : 405;
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      res.setHeader('Content-Length', '0');
      res.end();
      return;
    }

    var dir = decodeURIComponent(req.url);
    var path = Path.normalize(Path.join(rootPath, dir));
    fs.stat(path, function(err, stat){

      /* istanbul ignore next */ if (err) {
        if (err.code === 'ENOENT')
          return next();
        err.status = err.code === 'ENAMETOOLONG'
          ? 414
          : 500;
        return next(err);
      }

      if (!stat.isDirectory()) return next();
      fs.readdir(path, function(err, files){
        /* istanbul ignore if */ if (err) return next(err);
        res.json(files.sort())
      });
    });
  });

  appStoreServer.use(async function (req, res, next) {
    const parsedPath = Path.parse(req.url);
    const relativePath = Path.join(conf.documentRoot, parsedPath.dir);
    try {
      const files = await fs.promises.readdir(relativePath);

      // exact match
      if (files.indexOf(parsedPath.base) !== -1)
        return next();

      // matches up to '.'
      // TODO: should do conneg if there are more than one match
      const stem = files.find(
        f => f.startsWith(parsedPath.base) && f[parsedPath.base.length] === '.'
      );

      if (stem) {
        req.url = Path.join(parsedPath.dir, stem);
        return next()
      }

      // no match
      // createError(404, req.originalUrl)
      next(createError(404, Path.join(relativePath, parsedPath.base)))
    } catch (e) /* istanbul ignore next */ {
      console.warn('unexpected exception: ' + (e.stack || e.message))
      e.status = e.status || 500;
      next(e)
    }
  });

  /* use the static server
   */
  appStoreServer.use(express.static(conf.documentRoot, {
    setHeaders: function (res, path, stat) {
      res.set('x-timestamp', Date.now())
    }
  }));

  appStoreServer.use(function errorHandler (err, req, res, next) {
    res.status(err.status) //  || 500
    res.json({
      message: err.message,
      error: err
    });
  });
}
module.exports = appStoreServer;
