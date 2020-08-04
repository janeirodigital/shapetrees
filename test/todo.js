function Todo () {
  const Prefixes = require('../shapetree.js/lib/prefixes')
  const Errors = require('../shapetree.js/lib/rdf-errors');
  const N3 = require('n3');
  const { namedNode, literal, defaultGraph, quad } = N3.DataFactory;
  const Relateurl = require('relateurl');
  const H = require('./test-harness'); // @@ should not be needed in this module


  //
  // Constants
  //

  /**
   * Bit labels for access levels.
   */
  const Access = {
    Read: 0x1,
    Write: 0x2,
    Control: 0x4,
    Append: 0x8
  }

  //
  // Methods
  //

// proposed RemoveShapeTree method with s/st/this/
   /** Walk ShapeTree's referenced items
    *
    * @param {URL} stUrl
    * @returns {} e.g.
        {
          "cr/cr-ShapeTree#c3c1": [
            "<cr/cr-ShapeTree#c3>"
          ],
          "cr/cr-ShapeTree#c3c1r": [
            "<cr/cr-ShapeTree#c3>",
            "<cr/cr-ShapeTree#c3c1>"
          ],
          ...
        }
   * @throws {Error} unexpected duplicated results for some referee
   */
  async function getShapeTreeParents (st) {
    // console.warn('st.ids:', JSON.stringify(Todo.flattenUrls(st.ids)))

    const it = st.walkReferencedTrees(
      0
        | H.ShapeTree.RemoteShapeTree.REPORT_CONTAINS
        // | H.ShapeTree.RemoteShapeTree.REPORT_REERENCES
        | H.ShapeTree.RemoteShapeTree.RECURSE_CONTAINS
        // | H.ShapeTree.RemoteShapeTree.RECURSE_REERENCES
    )
    const ret = {};
    let iterResponse = {value:{via:[]}}
    while (!(iterResponse = await it.next()).done) {
      const value = iterResponse.value
      const referee = targetShapeTree(value.result)
      const via = [st.url].concat(value.via.map(targetShapeTree))
      console.warn('value:', JSON.stringify(flattenUrls({referee, via}), null, 2))
      if (referee.href in ret)
        throw Error(`getShapeTreeParents tried to replace ${referee.href} lineage ${JSON.stringify(ret[referee.href])} with ${JSON.stringify(via)}`)
      ret[referee.href] = via
    }
    return ret

  }

  function targetShapeTree (v) {
    return v.type === 'contains' ? v.target : v.target.treeStep
  }

  /**
   * Create a mirror rule from the rule request object.
   * @param {} req
   * @returns {} indexed rule object, e.g.
    {
      "rule": {
        "id": "<mr/mr-App#dashboard-r>",
        "supports": "<mr/mr-App#medical-record-r>",
        "inNeedSet": [ "<mr/mr-App#general>" ],
        "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
        "hasShapeTree": "<mr/dashboard-ShapeTree#dashboards>",
        "recursivelyAuthorize": true,
        "requestedAccess": 1
      },
      "bySupports": {
        "mr/mr-ShapeTree#appointment": [
          {
            "@id": "<mr/dashboard-ShapeTree#temporal-appointment>",
            "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
            "matchesUriTemplate": "{id}",
            "validatedBy": "<mr/dashboard-schema#TemporalAppointmentShape>",
            "supports": [ "<mr/mr-ShapeTree#appointment>" ]
          }
        ],
        // ...
      }
    }
   */
  async function addMirrorRule (req) {
    const t = await H.ShapeTree.RemoteShapeTree.get(req.hasShapeTree)
    // console.warn(JSON.stringify(flattenUrls(t.ids), null, 2))
    return {
      rule: req,
      bySupports: Object.keys(t.ids).reduce((acc, key) => {
        (t.ids[key].supports || []).forEach(
          sup => {
            if (!(sup.href in acc))
              acc[sup.href] = []
            acc[sup.href].push(t.ids[key])
          })
        return acc
      }, {})
    }
  }

  /**
   * calls addRow with the passed access request and recursively with each skos:narrower node.
   * @param {} req
   * @param {} done
   * @param {} decorators
   * @param {} drawQueue
   * @param {} requests
   * @param {} mirrorRules
   * @throws {} 
   */
  async function setAclsFromRule (req, done, decorators, drawQueue, requests, mirrorRules) {
    // console.warn(`setAclsFromRule (${JSON.stringify(req)}, ${done})`)

    // find the assocated decorator @@ should it crawl up the ShapeTree hierarchy?
    const decorator = decorators.byShapeTree[req.hasShapeTree.href]
    if (!decorator)
      throw Error(`${req.hasShapeTree} not found in ${decorators.byShapeTree.map(decorator => `${Object.keys(decorator.byShapeTree)}`)}`)

    await buildRule(decorator)

    async function buildRule (d) {
      if (done.indexOf(d.treeStep.href) !== -1)
        return
      done.push(d.treeStep.href)
      await addRow(d, req, done, decorators, drawQueue, requests, mirrorRules)
      await Promise.all((d.narrower || []).map(async n => buildRule(decorators.byId[n.href])))
    }
  }

  /**
   * Add the {decorator, req, step} to the results and call setAclsFromRule with each nested contains or references.
   * @param {} decorator
   * @param {} req
   * @param {} done
   * @param {} decorators
   * @param {} drawQueue
   * @param {} requests
   * @param {} mirrorRules
   */
  async function addRow (decorator, req, done, decorators, drawQueue, requests, mirrorRules) {
    const st = await H.ShapeTree.RemoteShapeTree.get(req.hasShapeTree)
    const step = st.ids[req.hasShapeTree]
    drawQueue.push({decorator, req, step})

    const it = st.walkReferencedTrees(
      0
        | H.ShapeTree.RemoteShapeTree.REPORT_CONTAINS
        | H.ShapeTree.RemoteShapeTree.REPORT_REERENCES
        | H.ShapeTree.RemoteShapeTree.RECURSE_CONTAINS
        | H.ShapeTree.RemoteShapeTree.RECURSE_REERENCES
    )
    const ret = {};
    let iterResponse = {value:{via:[]}}
    while (!(iterResponse = await it.next()).done) {
      const value = iterResponse.value
      const referee = targetShapeTree(value.result)
      if (done.indexOf(referee) === -1)
        await setAclsFromRule(requests[referee.href] || req, done, decorators, drawQueue, requests, mirrorRules)
    }
  }

  /**
   * Walk through app app rules, ShapeTrees and decorators to produce a drawQueue.
   *
   * This calls setAclsFromRule which in turn calls addRow which recursively
   * calls setAclsFromRule for contained or referenced rules.
   * @param {} crApp
   * @param {} langPrefs
   * @returns {Array} drawQueue - user interface items to present to pilot
   */
  async function visitAppRules (crApp, langPrefs) {
    let DecoratorIndex = {}
    const drawQueue = []

    // Walk through each AccessNeedGroup seperately.
    await Promise.all(crApp.groupedAccessNeeds.map(async grp => {

      // Get all of the ShapeTree URLs mentioned in the group's rules.
      const appsShapeTreeUrls = Object.keys(grp.byShapeTree).reduce(
        (grpReqs, stUrlString) =>
          grpReqs.concat(grp.byShapeTree[stUrlString].hasShapeTree), []
      )

      // Get any decorator indexes mentioned in the ShapeTree documents.
      const decoratorIndexUrlStrings = (await Promise.all(appsShapeTreeUrls.map(async url => {
        const urlStr = url.href.substr(0, url.href.length - url.hash.length)
        const st = new H.ShapeTree.RemoteShapeTree(new URL(urlStr))
        await st.fetch()
        return st.hasShapeTreeDecoratorIndex
      })))
            .filter(indexList => indexList) // Remove ones with no decorator index.
            .reduce((acc, indexList) => { // Remove duplicates
              indexList.map(u => {
                if (acc.indexOf(u.href) === -1)
                  acc.push(u.href)
              })
              return acc
            }, [])

      // Load each decorator resource...
      await Promise.all(decoratorIndexUrlStrings.map(async urlStr => {
        const stIndexUrl = new URL(urlStr, H.appStoreBase)
        const indexResource = new H.ShapeTree.RemoteResource(stIndexUrl)
        await indexResource.fetch()
        const index = parseDecoratorIndexGraph(indexResource.graph, stIndexUrl)

        // Find a series that matches the language preferences or is listed as the decorator's fallback language.
        let lang = langPrefs.find(
          lang => index.hasSeries.find(
            series => series.languageCode === lang))
        if (!lang) {
          console.warn(`found none of your preferred langaguages (${langPrefs.join(',')}); falling back to system pref ${index.fallbackLanguage}`)
          lang = index.fallbackLanguage
        }
        const series = index.hasSeries.find(series => series.languageCode === lang) // stupidly redundant against above?
        const latest = series.hasLineage[0] // Index parser leaves lineage array in reverse order.

        // Load the linked decorator resource
        const decoratorUrl = latest.hasDecoratorResource
        const decoratorResource = new H.ShapeTree.RemoteResource(decoratorUrl)
        await decoratorResource.fetch()

        // Cashe the loaded graph.
        DecoratorIndex[decoratorResource.url.href] = parseDecoratorGraph(decoratorResource.graph)
      }));

      // Merge decorators into byShapeTree indexes by name and by subject node in decorator graph.
      // @@ assumes no redundancy.
      const decorators = {
        byShapeTree: Object.keys(DecoratorIndex).reduce((outer, key) => {
          Object.keys(DecoratorIndex[key].byShapeTree).reduce((inner, stLabel) => {
            const decorator = DecoratorIndex[key].byShapeTree[stLabel]
            inner[stLabel] = decorator;
            return inner}, outer);
          return outer;
        }, {} ),
        byId: Object.keys(DecoratorIndex).reduce((outer, key) => {
          Object.keys(DecoratorIndex[key].byShapeTree).reduce((inner, stLabel) => {
            const decorator = DecoratorIndex[key].byShapeTree[stLabel]
            inner[decorator.id.href] = decorator;
            return inner}, outer);
          return outer;
        }, {} )
      }

      // Flatten each group's requestsAccess into a single list.
      const rootRules = crApp.groupedAccessNeeds.reduce(
        (rootRules, grp) =>
          grp.requestsAccess.reduce(
            (grpReqs, req) =>
              grpReqs.concat(req), rootRules
          )
        , []
      )

      // Extract the mirror rules..
      // Not sure these are needed at this stage. They can't really be executed until UI time.
      const mirrorRules = (await Promise.all(rootRules.filter(
        req => 'supports' in req // get the requests with supports
      ).map(
        req => addMirrorRule(req) // get promises for them
      ))).reduce(
        (mirrorRules, res) => mirrorRules.concat(res), [] // flatten the resulting list
      )
      console.warn('mirrorRules:', JSON.stringify(mirrorRules.map(supRule => ({
        rule: flattenUrls(supRule.rule.id),
        bySupports: Object.entries(supRule.bySupports).map(ent => {
          const [from, lst] = ent
          const ret = {}
          ret[from] = lst.map(st => flattenUrls(st['@id']))
          return ret
        })
      })), null, 2))

      // Recursively set ACLs on the non-mirror rules.
      const done = []
      await Promise.all(rootRules.filter(
        req => !('supports' in req) // get the requests with supports
      ).map(
        async req => {
          await setAclsFromRule(req, done, decorators, drawQueue, grp.byShapeTree, mirrorRules) // set ACLs
        }
      ))
    }))
    return drawQueue
  }

  /**
   * Recursively turn URL objects into <urlString>s
   * @param {} obj
   * @returns {}
   */
  function flattenUrls (obj) {
    if (!obj) {
      return obj
    } else if (obj instanceof URL) {
      const href = obj.host === H.appStoreBase.host ? Relateurl.relate(H.appStoreBase.href, obj.href) : obj.href
      return '<' + href + '>'
    } else if (obj instanceof Array) {
      return Object.keys(obj).reduce(
        (acc, key) => acc.concat(flattenUrls(obj[key])) , []
      )
    } else if (typeof obj === 'object') {
      return Object.keys(obj).reduce((acc, key) => {
        acc[shorten(key)] = flattenUrls(obj[key])
        return acc
      }, {})
    } else {
      return obj
    }
  }

  function shorten (str) {
    return str.startsWith(H.appStoreBase.href)
      ? str.substr(H.appStoreBase.href.length)
      : str
  }

  //
  // parser support
  // parse application structures from RDF graphs
  //

  const nn = (prefix, lname) => namedNode(Prefixes[prefix] + lname)

  /**
   * Simple but effective rule-based conversion of RDF graph to language-native object.
   *
   * @param {} graph - RDFJS graph
   * @param {} rules - array of objects: { predicate: URL string, attr: object attribute, f: callback },
   * @param {} subjects - starting list of subjects, e.g. [<http://...>]
   * @param {} includeId - attribute to add for each subject to get e.g. { "id": <mr/mr-App#agent> }
   * @returns {}
   */
  function visitNode (graph, rules, subjects, includeId) {
    return subjects.map(s => {
      // Index by predicate.
      const byPredicate = graph.getQuads(s, null, null).reduce((acc, q) => {
        const p = q.predicate.value
        if (!(p in acc))
          acc[p] = []
        acc[p].push(q.object)
        return acc
      }, {})

      // Construct return object.
      const ret = {}
      if (includeId)
        ret[includeId] = new URL(s.value)

      // Recursively apply rules to populate ret.
      return rules.reduce((acc, rule) => {
        const p = rule.predicate
        if (p in byPredicate)
          acc[rule.attr] = rule.f(byPredicate[p], graph, s)
        return acc
      }, ret)
    })
  }

  // Commonly-used visitNode callbacks
  const str = sz => one(sz).value
  const flt = sz => parseFloat(one(sz).value)
  const url = sz => new URL(one(sz).value)
  const lst = sz => sz.map(s => new URL(s.value))
  const bol = sz => one(sz).value === 'true'
  const one = sz => sz.length === 1
        ? sz[0]
        : (() => {throw new Errors.ShapeTreeStructureError(null, `Expected one object, got [${sz.map(s => s.value).join(', ')}]`)})()

  /**
   * Parse an eco:Application.
   * @param {RDF graph} g
   * @returns {Application}
   */
  function parseApplication (g) {

    // parser rules and supporting functions:
    const acc = (sz, g) => { // parse access level
      return sz.reduce(
        (acc, s) => acc | Access[s.value.substr(Prefixes.acl.length)]
        , 0x0
      )
    }
    const accessNeedRules = [
      { predicate: Prefixes.eco + 'supports'               , attr: 'supports'               , f: url },
      { predicate: Prefixes.eco + 'inNeedSet'              , attr: 'inNeedSet'              , f: lst },
      { predicate: Prefixes.eco + 'requestedAccessLevel'   , attr: 'requestedAccessLevel'   , f: url },
      { predicate: Prefixes.tree + 'hasShapeTree'          , attr: 'hasShapeTree'           , f: url },
      { predicate: Prefixes.eco + 'recursivelyAuthorize'   , attr: 'recursivelyAuthorize'   , f: bol },
      { predicate: Prefixes.eco + 'requestedAccess'        , attr: 'requestedAccess'        , f: acc },
    ]
    const ned = (sz, g) => visitNode(g, accessNeedRules, sz, 'id')

    const needGroupRules = [
      { predicate: Prefixes.eco + 'requestsAccess'         , attr: 'requestsAccess'         , f: ned },
      { predicate: Prefixes.eco + 'authenticatesAsAgent'   , attr: 'authenticatesAsAgent'   , f: url },
    ]
    const grp = (sz, g) => visitNode(g, needGroupRules, sz, 'id')

    const applicationRules = [
      { predicate: Prefixes.eco + 'applicationDescription' , attr: 'applicationDescription' , f: str },
      { predicate: Prefixes.eco + 'applicationDevelopedBy' , attr: 'applicationDevelopedBy' , f: str },
      { predicate: Prefixes.eco + 'authorizationCallback'  , attr: 'authorizationCallback'  , f: url },
      { predicate: Prefixes.eco + 'applicationDecoratorIndex' , attr: 'applicationDecoratorIndex' , f: url },
      { predicate: Prefixes.eco + 'groupedAccessNeeds'     , attr: 'groupedAccessNeeds'     , f: grp },
    ]

    // Parse the only eco:Application into language-native object.
    const root = g.getQuads(null, nn('rdf', 'type'), nn('eco', 'Application'))[0].subject
    const ret = visitNode(g, applicationRules, [root], 'id')[0]

    // For each AccessNeedGroup,
    ret.groupedAccessNeeds.forEach(grpd => {

      // ... index the rules in that group by their ShapeTree.
      grpd.byShapeTree = {}
      const needsId = grpd.id.href
      grpd.requestsAccess.forEach(req => { grpd.byShapeTree[req.hasShapeTree.href] = req })
      const requestsAccess = grpd.requestsAccess.map(req => req.id.href)
      g.getQuads(null, nn('eco', 'inNeedSet'), namedNode(needsId))
        .map(q => q.subject.value)
        .filter(n => requestsAccess.indexOf(n) === -1)
        .forEach(n => {
          const rule = ned([namedNode(n)], g)[0]
          grpd.byShapeTree[rule.hasShapeTree.href] = rule
        })
    })
    return ret
  }

  /**
   * Parse an eco:ShapeTreeDecoratorIndex.
   * @param {RDF graph} g
   * @returns {Index}
   */
  function parseDecoratorIndexGraph (g, start) {

    // parser rules and supporting functions:
    const lineageRules = [
      { predicate: Prefixes.eco + 'hasVersion', attr: 'hasVersion', f: flt },
      { predicate: Prefixes.eco + 'hasSHA3256' , attr: 'hasSHA3256' , f: str },
      { predicate: Prefixes.eco + 'hasDecoratorResource', attr: 'hasDecoratorResource', f: url },
    ]
    const lineage = (sz, g) => visitNode(g, lineageRules, sz, 'id')

    const seriesRules = [
      { predicate: Prefixes.eco + 'languageCode', attr: 'languageCode', f: str },
      { predicate: Prefixes.eco + 'hasLineage', attr: 'hasLineage', f: lineage },
    ]
    const series = (sz, g) => visitNode(g, seriesRules, sz, 'id')

    const indexRules = [
      { predicate: Prefixes.eco + 'fallbackLanguage', attr: 'fallbackLanguage', f: str },
      { predicate: Prefixes.eco + 'hasSeries', attr: 'hasSeries', f: series },
    ]

    // Parse the only eco:ShapeTreeDecoratorIndex into language-native object.
    // const indexNode = one(g.getQuads(null, nn('rdf', 'type'), nn('eco', 'ShapeTreeDecoratorIndex'))).subject
    const indexNode = namedNode(start.href)
    const index = visitNode(g, indexRules, [indexNode], 'id')[0]

    // Order each series's lineage from latest to earliest.
    index.hasSeries.forEach(series => {
      series.hasHiearchy = series.hasLineage.sort(
        (l, r) => r.hasVersion - l.hasVersion
      )
    })

    return index
  }

  /**
   * Parse an eco ShapeTree decorator (SKOS) graph.
   * @param {RDF graph} g
   * @returns {} SKOS hiearchy indexed by scheme and by ShapeTree
   */
  function parseDecoratorGraph (g) {

    // parser rules:
    const labelRules = [
      { predicate: Prefixes.skos + 'inScheme', attr: 'inScheme', f: url },
      { predicate: Prefixes.skos + 'narrower', attr: 'narrower', f: lst },
      { predicate: Prefixes.tree + 'treeStep' , attr: 'treeStep' , f: url },
      { predicate: Prefixes.skos + 'prefLabel', attr: 'prefLabel', f: str },
      { predicate: Prefixes.skos + 'definition', attr: 'definition', f: str },
    ]

    // Parse all tree:ShapeTreeLabels into language-native objects.
    const labelNodes = g.getQuads(null, nn('rdf', 'type'), nn('tree', 'ShapeTreeLabel')).map(q => q.subject)
    const labels = labelNodes.map(label => visitNode(g, labelRules, [label], 'id')[0])

    // Index by SKOS scheme and ShapeTree.
    const byScheme = labels.reduce((acc, label) => {
      const scheme = label.inScheme.href
      if (!(scheme in acc))
        acc[scheme] = []
      acc[scheme].push(label)
      return acc
    }, {})
    const byShapeTree = labels.reduce((acc, label) => {
      const shapeTree = label.treeStep.href
      acc[shapeTree] = label
      return acc
    }, {})

    return { byScheme, byShapeTree }
  }

  function dump (str, obj) {
    if (arguments.length === 1) {
      obj = str
      str = 'dump' + dump.no++
    }
    console.warn(str + ':', JSON.stringify(flattenUrls(obj), null, 2))
  }
  dump.no = 0

  return {
    getShapeTreeParents,
    addMirrorRule,
    setAclsFromRule,
    parseApplication,
    visitAppRules,
    flattenUrls,
    parseDecoratorIndexGraph,
    parseDecoratorGraph,
    dump
  }
}

module.exports = Todo
