/**
 * environment: SHAPETREE=client disables ShapeTree support.
 */

// Express server
const Express = require('express');
const Cors = require('cors');
const BodyParser = require('body-parser');
// const Morgan = require('morgan');

// Logging
const Debug = require('debug');
const Log = Debug('LDP');

// Local ecosystem
const LdpConf = JSON.parse(require('fs').readFileSync('./servers/config.json', 'utf-8')).LDP;
const Prefixes = require('../shapetree.js/lib/prefixes');
const RdfSerialization = require('../shapetree.js/lib/rdf-serialization')
const Errors = require('../shapetree.js/lib/rdf-errors');
const FileSystem = new (require('../filesystems/fs-promises-utf8'))(LdpConf.documentRoot, LdpConf.indexFile, RdfSerialization)
const CallEcosystemFetch = (url, /* istanbul ignore next */options = {}) => Ecosystem.fetch(url, options); // avoid circular dependency on ShapeTree and Ecosystem.
const ShapeTree = require('../shapetree.js/lib/shape-tree')(FileSystem, RdfSerialization, require('../filesystems/fetch-self-signed')(CallEcosystemFetch))
const Ecosystem = new (require('../shapetree.js/ecosystems/simple-apps'))(FileSystem, ShapeTree, RdfSerialization);

const NoShapeTrees = process.env.SHAPETREE === 'fetch';

// Prepare server
const ldpServer = Express();
let Base = null
ldpServer.setBase = function (server, base) {
  Base = base;
  module.exports.initialized = Ecosystem.initialize(Base, LdpConf).then(hierarchy => ({ hierarchy, shapeTree: ShapeTree }));
  Log(`Listening on ${base.href}`);
}

// Export server
module.exports = ldpServer;

runServer();
// All done

async function runServer () {

  // Enable pre-flight request for DELETE request.
  const CorsHandler = Cors({
    credentials: true,
    origin: function (origin, callback) {
      // allow any origin
      callback(null, true)
      // else callback(new Error(`origin ${origin} not allowed by CORS`))
    },
    method: 'DELETE',
  });
  ldpServer.use(function (req, res, next) {
    // Log('cors', req.method, req.url);
    return CorsHandler(req, res, next);
  })
  ldpServer.use(BodyParser.raw({ type: 'text/turtle', limit: '50mb' }));
  ldpServer.use(BodyParser.raw({ type: 'application/ld+json', limit: '50mb' }));

  ldpServer.use(async function (req, res, next) {
    // console.warn(`+ LDP server ${req.method} ${req.url} ${['PUT', 'POST'].indexOf(req.method) !== -1 ? JSON.stringify(req.body.toString('utf8')) : ''}`);
    try {
      Log('handle', req.method, req.url)
      const requestUrl = new URL(req.url.replace(/^\//, ''), Base)
      const rstat = await rstatOrNull(requestUrl);
      const links = parseLinks(req);

      switch (req.method) {

      case 'POST': {
        // Make sure POSTed URL exists.
        throwIfNotFound(rstat, requestUrl, req.method);
        // Store a new resource or create a new ShapeTree
        const postedContainer = NoShapeTrees
              ? await new ShapeTree.Container(requestUrl).ready
              : await ShapeTree.loadContainer(requestUrl);

        const ldpType = links.type.substr(Prefixes.ns_ldp.length); // links.type ? links.type.substr(Prefixes.ns_ldp.length) : null;
        const toAdd = await firstAvailableFile(requestUrl, req.headers.slug, ldpType);
        let location = new URL(toAdd, requestUrl);

        const isPlantRequest = !!links.shapeTree;
        if (!NoShapeTrees && isPlantRequest) {

          // Parse payload early so we can throw before creating a ShapeTree instance.
          const payloadGraph = await RdfSerialization.parseRdf(
            req.body.toString('utf8'), requestUrl, req.headers['content-type']
          );

          // Create ShapeTree instance and tell ecosystem about it.
          const shapeTreeUrl = new URL(links.shapeTree, requestUrl); // !! should respect anchor per RFC5988 §5.2
          const [finalLocation, respBody, respMediaType]
                = await Ecosystem.plantShapeTreeInstance(shapeTreeUrl, postedContainer, location, payloadGraph);

          res.setHeader('Location', finalLocation.href);
          res.status(201); // Should ecosystem be able to force a 304 Not Modified ?
          res.setHeader('Content-type', respMediaType);
          res.send(respBody);
        } else {

          // Validate the posted data according to the ShapeTree rules.
          const entityUrl = new URL(links.root, location); // !! should respect anchor per RFC5988 §5.2
          const payload = req.body.toString('utf8');
          const mediaType = req.headers['content-type'];
          const [payloadGraph, dirMaker] = postedContainer instanceof ShapeTree.ManagedContainer
                ? await postedContainer.validatePayload(payload, location, mediaType, ldpType, entityUrl)
                : await postUnmanaged(location, payload, mediaType, ldpType);

          if (ldpType === 'Container') {

            // If it's a Container, create the container and add the POSTed payload.
            const dir = await dirMaker();
            await dir.merge(payloadGraph, location);
            await dir.write()

          } else {

            // Write any non-Container verbatim.
            await FileSystem.write(location, payload, {encoding: 'utf8'});

          }

          // Add to POSTed container.
          postedContainer.addMember(location.href);
          await postedContainer.write();

          res.setHeader('Location', location.href);
          res.status(201);
          res.send();
        }
        break;
      }

      case 'PUT': {
        // Store a new resource or create a new ShapeTree
        const parentUrl = new URL(requestUrl.pathname.endsWith('/') ? '..' : '.', requestUrl);
        const pstat = rstatOrNull(parentUrl);
        await throwIfNotFound(pstat, requestUrl, req.method);
        const postedContainer = NoShapeTrees
              ? await new ShapeTree.Container(parentUrl).ready
              : await ShapeTree.loadContainer(parentUrl);

        const ldpType = requestUrl.pathname.endsWith('/') ? 'Container' : 'Resource';
        let location = requestUrl;

        {

          // Validate the posted data according to the ShapeTree rules.
          const entityUrl = new URL(links.root, location); // !! should respect anchor per RFC5988 §5.2
          const payload = req.body.toString('utf8');
          const mediaType = req.headers['content-type'];
          const [payloadGraph, dirMaker] = postedContainer instanceof ShapeTree.ManagedContainer
                ? await postedContainer.validatePayload(payload, location, mediaType, ldpType, entityUrl)
                : await postUnmanaged(location, payload, mediaType, ldpType);

          if (ldpType === 'Container') {

            // If it's a Container, create the container and override its graph with the POSTed payload.
            const dir = await dirMaker();
            dir.graph = payloadGraph;
            await dir.write()

          } else {

            // Write any non-Container verbatim.
            await FileSystem.write(location, payload, {encoding: 'utf8'});

          }

          // Add to POSTed container.
          postedContainer.addMember(location.href);
          await postedContainer.write();

          res.status(201);
          res.send();
        }
      }
        break;

      case 'DELETE': {
        const doomed = requestUrl;
        if (doomed.pathname === '/') {
          res.status(405);
          res.send();
        } else {
          // Get status of DELETEd URL.
          throwIfNotFound(rstat, requestUrl, req.method);
          const parentUrl = new URL(doomed.pathname.endsWith('/') ? '..' : '.', doomed);
          const postedContainer = NoShapeTrees
                ? await new ShapeTree.Container(parentUrl).ready
                : await ShapeTree.loadContainer(parentUrl);
          if (rstat.isContainer) {
            // Read the container
            const container = NoShapeTrees
              ? await new ShapeTree.Container(doomed).ready
              : await ShapeTree.loadContainer(doomed);
            // If it's the root of a ShapeTree instance,
            if (container.shapeTreeInstanceRoot
                && container.shapeTreeInstanceRoot.href === container.url.href)
              // Tell the ecosystem to unindex it.
              Ecosystem.unindexInstalledShapeTree(postedContainer, doomed, container.shapeTreeUrl);
            await FileSystem.removeContainer(requestUrl);
          } else {
            await FileSystem.remove(requestUrl);
          }
          postedContainer.removeMember(doomed.href, null);
          await postedContainer.write();
          res.status(200);
          res.send();
        }
        break;
      }

      case 'GET': {
        // Get status of request URL.
        throwIfNotFound(rstat, requestUrl, req.method);
        if (rstat.isContainer) { // should be isContainer()
          req.url = FileSystem.getIndexFilePath(new URL(req.url, Base));
          res.header('link' , '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"');
          res.header('access-control-expose-headers' , 'link');
        }
        // Fall through to express.static.
        next()
        break;
      }
      }
      // console.warn(`- LDP server ${req.method} ${req.url} ${res.statusCode}`);
    } catch (e) {
      // console.warn(`! LDP server ${req.method} ${req.url} ${e.status || 500} ${e}`);
      /* istanbul ignore else */
      if (e instanceof Errors.ManagedError) {
        /* istanbul ignore if */
        if (e.message.match(/^\[object Object\]$/))
          console.warn('fix up error invocation for:\n', e.stack);
      } else {
        console.warn('unmanaged exception: ' + (e.stack || e.message))
        e.status = e.status || 500;
      }
      return next(e)
    }    
  });

  // Use express.static for GETs on Resources and Containers.
  ldpServer.use(Express.static(LdpConf.documentRoot, {a: 1}));

  // Error handler expects structured error to build a JSON @@LD response.
  ldpServer.use(function (err, req, res, next) {
    res.status(err.status)
    res.json({
      message: err.message,
      error: err,
      stack: err.stack
    });
  });
}

function throwIfNotFound (rstat, url, method) {
  if (rstat)
    return;
  const error = new Errors.NotFoundError(url, 'queried resource', `${method} ${url.pathname}`);
  error.status = 404;
  throw error;
}

async function rstatOrNull (url) {
  try {
    return await FileSystem.rstat(url);
  } catch (e) {
    return null;
  }
}

/** PUT or POST to an unmanaged LDPC
 */
async function postUnmanaged (location, payload, mediaType, ldpType) {
  let payloadGraph = null;
  const prefixes = {};

  if (ldpType == 'NonRDFSource') {
    ;
  } else {
    payloadGraph = await RdfSerialization.parseRdf(payload, location, mediaType, prefixes);
  }
  // Return a trivial lambda for creating a single Container.
  return [payloadGraph, async () => {
    const dir = await new ShapeTree.Container(location, `index for unmanaged Container ${location.pathname}`).ready;
    Object.assign(dir.prefixes, prefixes, dir.prefixes); // inject the parsed prefixes
    return dir;
  }];
}

async function firstAvailableFile (parentUrl, slug, type) {
  let unique = 0;
  let tested;
  while (await FileSystem.exists(
    new URL(
      tested = (slug || type) + (
        unique > 0
          ? '-' + unique
          : ''
      ) + (type === 'Container' ? '/' : ''), parentUrl)
  ))
    ++unique;
  return tested
}

/*
 * returns e.g. {"type": "http://...#Container", "rel": "..."}
 */
function parseLinks (req) {
  const linkHeader = req.headers.link;
  if (!linkHeader) return {};
  const components = linkHeader.split(/<(.*?)> *; *rel *= *"(.*?)" *,? */);
  components.shift(); // remove empty match before pattern captures.
  const ret = {  };
  for (i = 0; i < components.length; i+=3)
    ret[components[i+1]] = components[i];
  return ret
  /* functional equivalent is tedious to maintain:
  return linkHeader.split(/(?:<(.*?)> *; *rel *= *"(.*?)" *,? *)/).filter(s => s).reduce(
    (acc, elt) => {
      if (acc.val) {
        acc.map[elt] = acc.val;
        return {map: acc.map, val: null};
      } else {
        return {map: acc.map, val: elt}
      }
    }, {map:{}, val:null}
  ).map
  */
}
