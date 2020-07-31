'use strict';

const expect = require('chai').expect;
const Rdf = require('../shapetree.js/lib/rdf-serialization')
const Fs = require('fs')
const Path = require('path')
const LdpConf = JSON.parse(require('fs').readFileSync('./servers/config.json', 'utf-8')).LDP;
const Shared = LdpConf.shared;
const H = require('./test-harness');
const Todo = require('./todo')()
H.init(LdpConf.documentRoot);
const testF = p => Path.join(__dirname, p)

describe(`apps, shapetrees and decorators`, function () {
  before(() => H.ensureTestDirectory(Shared));

  let MrApp, MrShapeTree, DashShapeTree, DecoratorIndex = {}
  describe(`end-to-end`, () => {
    it (`parse App ID`, async () => {
      const appPrefixes = {}
      const appUrl = new URL('mr/mr-App#agent', H.appStoreBase)
      const text = Fs.readFileSync(testF('../solidApps/staticRoot/mr/mr-App.ttl'), 'utf8')
      MrApp = Todo.parseApplication(await Rdf.parseTurtle(text, appUrl, appPrefixes))
      expect(Todo.flattenUrls(MrApp)).to.deep.equal(App1)
    })
    it (`parse med rec ShapeTree`, async () => {
      const stUrl = new URL('mr/mr-ShapeTree#medicalRecords', H.appStoreBase)
      MrShapeTree = await H.ShapeTree.RemoteShapeTree.get(stUrl)
      expect(MrShapeTree.hasShapeTreeDecoratorIndex.map(u => u.href)).to.deep.equal([ new URL('mr/mr-ShapeTree-SKOS', H.appStoreBase).href ])
      expect(Todo.flattenUrls(MrShapeTree.ids)).to.deep.equal(Todo.flattenUrls(MrShapeTreeIds1))

      const it = MrShapeTree.walkReferencedTrees(stUrl)
      const got = []
      for await (const answer of it)
        got.push(answer)
      // console.warn(JSON.stringify(got))
     })
    it (`parse dashboard ShapeTree`, async () => {
      const stUrl = new URL('mr/dashboard-ShapeTree#dashboards', H.appStoreBase)
      DashShapeTree = await H.ShapeTree.RemoteShapeTree.get(stUrl)
      expect(Todo.flattenUrls(DashShapeTree.ids)).to.deep.equal(Todo.flattenUrls(DashShapeTreeIds1))

      const it = DashShapeTree.walkReferencedTrees(stUrl)
      const got = []
      for await (const answer of it)
        got.push(answer)
      // console.warn(JSON.stringify(got))
    })
    it (`parse decorators`, async () => {
      const decoratorPrefixes = {}
      const tests = [['mr/mr-ShapeTree-SKOS', MrShapeTreeSkos1]]
      tests.forEach(async sourceAndResult => {
        const decoratorUrl = new URL(sourceAndResult[0], H.appStoreBase)
        const text = Fs.readFileSync(testF('../solidApps/staticRoot/mr/mr-ShapeTree-SKOS.ttl'), 'utf8')
        DecoratorIndex[decoratorUrl.href] = Todo.parseDecoratorGraph(await Rdf.parseTurtle(text, decoratorUrl, decoratorPrefixes))
        expect(Todo.flattenUrls(DecoratorIndex[decoratorUrl.href])).to.deep.equal(sourceAndResult[1])
      })
    })
    it (`build UI`, async () => {
      const accessNeedGroups = MrApp.groupedAccessNeeds

      // flatten each group's requestsAccess into a single list
      const rootRules = accessNeedGroups.reduce(
        (rootRules, grp) =>
          grp.requestsAccess.reduce(
            (grpReqs, req) =>
              grpReqs.concat(req), rootRules
          )
        , []
      )

      // First get the mirror rules.
      const mirrorRules = (await Promise.all(rootRules.filter(
        req => 'supports' in req // get the requests with supports
      ).map(
        req => Todo.addMirrorRule(req) // get promises for them
      ))).reduce(
        (mirrorRules, res) => mirrorRules.concat(res), [] // flatten the resulting list
      )
      console.warn('mirror rules:', JSON.stringify(mirrorRules.map(supRule => ({
        rule: Todo.flattenUrls(supRule.rule.id),
        bySupports: Object.entries(supRule.bySupports).map(ent => {
          const [from, lst] = ent
          const ret = {}
          ret[from] = lst.map(st => Todo.flattenUrls(st['@id']))
          return ret
        })
      })), null, 2))

      // Set ACLs on the non-mirror rules.
      const decorators = MrShapeTree.hasShapeTreeDecoratorIndex.map(u => DecoratorIndex[u.href])
      const drawQueue = []
      const done = []
      await Promise.all(rootRules.filter(
        req => !('supports' in req) // get the requests with supports
      ).map(
        req => Todo.setAclsFromRule(req, done, decorators, drawQueue, mirrorRules) // set ACLs
      ))
      console.warn('DONE')

      /*
       * This code is elegant, but the mirrorRules might precede the regular rules to which they'd apply:
      await Promise.all(accessNeedGroups
      .map(async grp => {
          const done = []
          await Promise.all(grp.requestsAccess
            .map(
              async req => req.supports
                ? mirrorRules.push(await todo.addMirrorRule(req, done, decorators, drawQueue))
                : await Todo.setAclsFromRule(req, done, decorators, drawQueue, mirrorRules)
            ))
        }))
      */
    })
  });
           
  if (false) describe('shapetree navigation', function () {
    H.walkReferencedTrees({
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#org', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      control: 0xF,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "contains", "target": "#org" },
          "via": [ ] },
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      control: 0x5,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "contains", "target": "#org" },
          "via": [ ] }
      ]
    });
    H.walkReferencedTrees({
      control: 0xD,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "contains", "target": "#org" },
          "via": [ ] }
      ]
    });
    H.walkReferencedTrees({
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree-split-org#org', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat-ShapeTree-split-issues#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "gh-flat-ShapeTree-split-issues#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "gh-flat-ShapeTree-split-issues#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [2, 0x3],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [1, 0x3],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [0, 0x3],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [2, 0],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedResources({
      prefixes: {"st": "gh-flat/gh-flat-ShapeTree#repos"},
      control: undefined,
      focus: `/${Shared}/Git-Users/ericprud.ttl#ericprud`, expect: [
        { "result": {
            "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
              "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#repository>" },
            "resource": "/Data/Git-Repos/jsg.ttl#jsg" },
          "via": [] },
        { "result": {
            "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#issue",
              "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" },
            "resource": "/Data/Git-Issues/issue1.ttl" },
          "via": [
            { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
                "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#repository>" },
              "resource": "/Data/Git-Repos/jsg.ttl#jsg" }
          ] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
              "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#repository>" },
            "resource": "/Data/Git-Repos/libxml-annot.ttl#libxml-annot" },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
              "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#subscription>" },
            "resource": "/Data/Git-Repos/jsg.ttl#jsg" },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#issue",
              "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" },
            "resource": "/Data/Git-Issues/issue1.ttl" },
          "via": [
            { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
                "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#subscription>" },
              "resource": "/Data/Git-Repos/jsg.ttl#jsg" }
          ] }
      ]
      /*
      [
        { "result": { "type": "reference", "target": "../Git-Orgs/shapetrees.ttl" },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "resource", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
      */
    });
  });

});

const App1 = {
  "id": "<mr/mr-App#agent>",
  "applicationDescription": "Health!",
  "applicationDevelopedBy": "HealthDev.co",
  "authorizationCallback": "<https://healthpad.example/callback>",
  "applicationDecoratorIndex": "<mr/mr-ShapeTree-SKOS>",
  "groupedAccessNeeds": [
    {
      "id": "<mr/mr-App#general>",
      "requestsAccess": [
        {
          "id": "<mr/mr-App#medical-record-r>",
          "inNeedSet": [
            "<mr/mr-App#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/mr-ShapeTree#medicalRecords>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        },
        {
          "id": "<mr/mr-App#dashboard-r>",
          "inNeedSet": [
            "<mr/mr-App#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/dashboard-ShapeTree#dashboards>",
          "recursivelyAuthorize": true,
          "supports": "<mr/mr-App#medical-record-r>",
          "requestedAccess": 1
        }
      ],
      "authenticatesAsAgent": "<acl:Pilot>",
      "byShapeTree": {
        "mr/mr-App#medical-record-r": {
          "id": "<mr/mr-App#medical-record-r>",
          "inNeedSet": [
            "<mr/mr-App#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/mr-ShapeTree#medicalRecords>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        },
        "mr/mr-App#dashboard-r": {
          "id": "<mr/mr-App#dashboard-r>",
          "inNeedSet": [
            "<mr/mr-App#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/dashboard-ShapeTree#dashboards>",
          "recursivelyAuthorize": true,
          "supports": "<mr/mr-App#medical-record-r>",
          "requestedAccess": 1
        },
        "mr/mr-App#patient-rw": {
          "id": "<mr/mr-App#patient-rw>",
          "inNeedSet": [
            "<mr/mr-App#general>",
            "<mr/mr-App#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/mr-ShapeTree#patients>",
          "recursivelyAuthorize": true,
          "requestedAccess": 3
        },
        "mr/mr-App#condition-rw": {
          "id": "<mr/mr-App#condition-rw>",
          "inNeedSet": [
            "<mr/mr-App#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/mr-ShapeTree#conditions>",
          "recursivelyAuthorize": true,
          "requestedAccess": 3
        }
      }
    },
    {
      "id": "<mr/mr-App#med-management>",
      "requestsAccess": [
        {
          "id": "<mr/mr-App#prescriptions-rw>",
          "inNeedSet": [
            "<mr/mr-App#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/mr-ShapeTree#prescriptions>",
          "recursivelyAuthorize": false,
          "requestedAccess": 3
        }
      ],
      "authenticatesAsAgent": "<acl:Pilot>",
      "byShapeTree": {
        "mr/mr-App#prescriptions-rw": {
          "id": "<mr/mr-App#prescriptions-rw>",
          "inNeedSet": [
            "<mr/mr-App#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/mr-ShapeTree#prescriptions>",
          "recursivelyAuthorize": false,
          "requestedAccess": 3
        },
        "mr/mr-App#patient-rw": {
          "id": "<mr/mr-App#patient-rw>",
          "inNeedSet": [
            "<mr/mr-App#general>",
            "<mr/mr-App#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<mr/mr-ShapeTree#patients>",
          "recursivelyAuthorize": true,
          "requestedAccess": 3
        }
      }
    }
  ]
}

const MrShapeTreeIds1 = {
  "mr/mr-ShapeTree#medicalRecords": {
    "@id": "<mr/mr-ShapeTree#medicalRecords>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "contains": [
      {
        "@id": "<mr/mr-ShapeTree#medicalRecord>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#medicalRecord>",
        "references": [
          {
            "treeStep": "<mr/mr-ShapeTree#patient>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:patient"
          },
          {
            "treeStep": "<mr/mr-ShapeTree#appointment>",
            "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
          },
          {
            "treeStep": "<mr/mr-ShapeTree#condition>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
          },
          {
            "treeStep": "<mr/mr-ShapeTree#prescription>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
          },
          {
            "treeStep": "<mr/mr-ShapeTree#allergy>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:allergy"
          },
          {
            "treeStep": "<mr/mr-ShapeTree#diagnosticTest>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
          }
        ]
      }
    ],
    "references": [
      {
        "treeStep": "<mr/mr-ShapeTree#patients>"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#appointments>"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#conditions>"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#prescriptions>"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#diagnosticTests>"
      }
    ]
  },
  "mr/mr-ShapeTree#medicalRecord": {
    "@id": "<mr/mr-ShapeTree#medicalRecord>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/medrecord-schema#medicalRecord>",
    "references": [
      {
        "treeStep": "<mr/mr-ShapeTree#patient>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:patient"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#appointment>",
        "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#condition>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#prescription>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#allergy>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:allergy"
      },
      {
        "treeStep": "<mr/mr-ShapeTree#diagnosticTest>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
      }
    ]
  },
  "mr/mr-ShapeTree#patients": {
    "@id": "<mr/mr-ShapeTree#patients>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "name": "patients",
    "contains": [
      {
        "@id": "<mr/mr-ShapeTree#patient>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#patientShape>"
      }
    ]
  },
  "mr/mr-ShapeTree#appointments": {
    "@id": "<mr/mr-ShapeTree#appointments>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "name": "appointments",
    "contains": [
      {
        "@id": "<mr/mr-ShapeTree#appointment>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#appointmentShape>"
      }
    ]
  },
  "mr/mr-ShapeTree#conditions": {
    "@id": "<mr/mr-ShapeTree#conditions>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "name": "conditions",
    "contains": [
      {
        "@id": "<mr/mr-ShapeTree#condition>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#conditionShape>"
      }
    ]
  },
  "mr/mr-ShapeTree#prescriptions": {
    "@id": "<mr/mr-ShapeTree#prescriptions>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "name": "prescriptions",
    "contains": [
      {
        "@id": "<mr/mr-ShapeTree#prescription>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#prescriptionShape>"
      }
    ]
  },
  "mr/mr-ShapeTree#diagnosticTests": {
    "@id": "<mr/mr-ShapeTree#diagnosticTests>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "name": "diagnosticTests",
    "contains": [
      {
        "@id": "<mr/mr-ShapeTree#condition>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#conditionShape>"
      },
      {
        "@id": "<mr/mr-ShapeTree#diagnosticTest>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#diagnosticTestShape>"
      }
    ]
  },
  "mr/mr-ShapeTree#patient": {
    "@id": "<mr/mr-ShapeTree#patient>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/medrecord-schema#patientShape>"
  },
  "mr/mr-ShapeTree#appointment": {
    "@id": "<mr/mr-ShapeTree#appointment>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/medrecord-schema#appointmentShape>"
  },
  "mr/mr-ShapeTree#condition": {
    "@id": "<mr/mr-ShapeTree#condition>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/medrecord-schema#conditionShape>"
  },
  "mr/mr-ShapeTree#prescription": {
    "@id": "<mr/mr-ShapeTree#prescription>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/medrecord-schema#prescriptionShape>"
  },
  "mr/mr-ShapeTree#allergy": {
    "@id": "<mr/mr-ShapeTree#allergy>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/medrecord-schema#allergyShape>"
  },
  "mr/mr-ShapeTree#diagnosticTest": {
    "@id": "<mr/mr-ShapeTree#diagnosticTest>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/medrecord-schema#diagnosticTestShape>"
  },
  "mr/mr-ShapeTree#allergies": {
    "@id": "<mr/mr-ShapeTree#allergies>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "name": "allergies",
    "contains": [
      {
        "@id": "<mr/mr-ShapeTree#allergy>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/medrecord-schema#allergyShape>"
      }
    ]
  }
}



const DashShapeTreeIds1 = {
  "mr/dashboard-ShapeTree#dashboards": {
    "@id": "<mr/dashboard-ShapeTree#dashboards>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "contains": [
      {
        "@id": "<mr/dashboard-ShapeTree#dashboard>",
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/dashboard-schema#DashboardShape>",
        "references": [
          {
            "treeStep": "<mr/dashboard-ShapeTree#temporal-appointment>",
            "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
          },
          {
            "treeStep": "<mr/dashboard-ShapeTree#current-condition>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
          },
          {
            "treeStep": "<mr/dashboard-ShapeTree#current-medicationRequest>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
          },
          {
            "treeStep": "<mr/dashboard-ShapeTree#temporal-diagnosticReport>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
          }
        ]
      }
    ],
    "references": [
      {
        "treeStep": "<mr/dashboard-ShapeTree#temporal-appointments>"
      },
      {
        "treeStep": "<mr/dashboard-ShapeTree#current-conditions>"
      },
      {
        "treeStep": "<mr/dashboard-ShapeTree#current-medicationRequests>"
      },
      {
        "treeStep": "<mr/dashboard-ShapeTree#temporal-diagnosticReports>"
      }
    ]
  },
  "mr/dashboard-ShapeTree#dashboard": {
    "@id": "<mr/dashboard-ShapeTree#dashboard>",
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/dashboard-schema#DashboardShape>",
    "references": [
      {
        "treeStep": "<mr/dashboard-ShapeTree#temporal-appointment>",
        "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
      },
      {
        "treeStep": "<mr/dashboard-ShapeTree#current-condition>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
      },
      {
        "treeStep": "<mr/dashboard-ShapeTree#current-medicationRequest>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
      },
      {
        "treeStep": "<mr/dashboard-ShapeTree#temporal-diagnosticReport>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
      }
    ]
  },
  "mr/dashboard-ShapeTree#temporal-appointments": {
    "@id": "<mr/dashboard-ShapeTree#temporal-appointments>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "contains": [
      {
        "@id": "<mr/dashboard-ShapeTree#temporal-appointment>",
        "supports": ["<mr/mr-ShapeTree#appointment>"],
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/dashboard-schema#TemporalAppointmentShape>"
      }
    ]
  },
  "mr/dashboard-ShapeTree#current-conditions": {
    "@id": "<mr/dashboard-ShapeTree#current-conditions>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "contains": [
      {
        "@id": "<mr/dashboard-ShapeTree#current-condition>",
        "supports": ["<mr/mr-ShapeTree#condition>"],
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/dashboard-schema#CurrentConditionShape>"
      }
    ]
  },
  "mr/dashboard-ShapeTree#current-medicationRequests": {
    "@id": "<mr/dashboard-ShapeTree#current-medicationRequests>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "contains": [
      {
        "@id": "<mr/dashboard-ShapeTree#current-medicationRequest>",
        "supports": ["<mr/mr-ShapeTree#prescription>"],
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/dashboard-schema#CurrentMedicationRequestShape>"
      }
    ]
  },
  "mr/dashboard-ShapeTree#temporal-diagnosticReports": {
    "@id": "<mr/dashboard-ShapeTree#temporal-diagnosticReports>",
    "expectsType": "<http://www.w3.org/ns/ldp#Container>",
    "contains": [
      {
        "@id": "<mr/dashboard-ShapeTree#temporal-diagnosticReport>",
        "supports": ["<mr/mr-ShapeTree#diagnosticTest>"],
        "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
        "matchesUriTemplate": "{id}",
        "validatedBy": "<mr/dashboard-schema#TemporalDiagnosticTestShape>"
      }
    ]
  },
  "mr/dashboard-ShapeTree#temporal-appointment": {
    "@id": "<mr/dashboard-ShapeTree#temporal-appointment>",
    "supports": ["<mr/mr-ShapeTree#appointment>"],
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/dashboard-schema#TemporalAppointmentShape>"
  },
  "mr/dashboard-ShapeTree#current-condition": {
    "@id": "<mr/dashboard-ShapeTree#current-condition>",
    "supports": ["<mr/mr-ShapeTree#condition>"],
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/dashboard-schema#CurrentConditionShape>"
  },
  "mr/dashboard-ShapeTree#current-medicationRequest": {
    "@id": "<mr/dashboard-ShapeTree#current-medicationRequest>",
    "supports": ["<mr/mr-ShapeTree#prescription>"],
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/dashboard-schema#CurrentMedicationRequestShape>"
  },
  "mr/dashboard-ShapeTree#temporal-diagnosticReport": {
    "@id": "<mr/dashboard-ShapeTree#temporal-diagnosticReport>",
    "supports": ["<mr/mr-ShapeTree#diagnosticTest>"],
    "expectsType": "<http://www.w3.org/ns/ldp#Resource>",
    "matchesUriTemplate": "{id}",
    "validatedBy": "<mr/dashboard-schema#TemporalDiagnosticTestShape>"
  }
}


const MrShapeTreeSkos1 = {
  "byShapeTree": {
    "mr/mr-ShapeTree#medicalRecords": {
      "id": "<mr/mr-ShapeTree-SKOS#medicalRecords>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
      "treeStep": "<mr/mr-ShapeTree#medicalRecords>",
      "prefLabel": "Medical Records",
      "definition": "A collection of Medical Records"
    },
    "mr/mr-ShapeTree#medicalRecord": {
      "id": "<mr/mr-ShapeTree-SKOS#medicalRecord>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
      "treeStep": "<mr/mr-ShapeTree#medicalRecord>",
      "prefLabel": "Medical Record",
      "definition": "An extensive view of your medical history"
    },
    "mr/mr-ShapeTree#patients": {
      "id": "<mr/mr-ShapeTree-SKOS#patients>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
      "treeStep": "<mr/mr-ShapeTree#patients>",
      "prefLabel": "Patients.",
      "definition": "Describes a receiver of medical care"
    },
    "mr/mr-ShapeTree#patient": {
      "id": "<mr/mr-ShapeTree-SKOS#patient>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
      "treeStep": "<mr/mr-ShapeTree#patient>",
      "prefLabel": "Patient",
      "definition": "Describes a receiver of medical care"
    },
    "mr/mr-ShapeTree#appointments": {
      "id": "<mr/mr-ShapeTree-SKOS#appointments>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
      "treeStep": "<mr/mr-ShapeTree#appointments>",
      "prefLabel": "Appointments.",
      "definition": "A time and place with someone"
    },
    "mr/mr-ShapeTree#appointment": {
      "id": "<mr/mr-ShapeTree-SKOS#appointment>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
      "treeStep": "<mr/mr-ShapeTree#appointment>",
      "prefLabel": "Appointment.",
      "definition": "A time and place with someone"
    },
    "mr/mr-ShapeTree#conditions": {
      "id": "<mr/mr-ShapeTree-SKOS#conditions>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
      "narrower": [
        "<mr/mr-ShapeTree-SKOS#prescriptions>",
        "<mr/mr-ShapeTree-SKOS#allergies>"
      ],
      "treeStep": "<mr/mr-ShapeTree#conditions>",
      "prefLabel": "Conditions.",
      "definition": "A diagnosed issue"
    },
    "mr/mr-ShapeTree#condition": {
      "id": "<mr/mr-ShapeTree-SKOS#condition>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
      "narrower": [
        "<mr/mr-ShapeTree-SKOS#prescription>",
        "<mr/mr-ShapeTree-SKOS#allergy>"
      ],
      "treeStep": "<mr/mr-ShapeTree#condition>",
      "prefLabel": "Condition.",
      "definition": "A diagnosed issue"
    },
    "mr/mr-ShapeTree#prescriptions": {
      "id": "<mr/mr-ShapeTree-SKOS#prescriptions>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
      "treeStep": "<mr/mr-ShapeTree#prescriptions>",
      "prefLabel": "prescriptions.",
      "definition": "prescriptions"
    },
    "mr/mr-ShapeTree#prescription": {
      "id": "<mr/mr-ShapeTree-SKOS#prescription>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
      "treeStep": "<mr/mr-ShapeTree#prescription>",
      "prefLabel": "prescription.",
      "definition": "prescription"
    },
    "mr/mr-ShapeTree#allergies": {
      "id": "<mr/mr-ShapeTree-SKOS#allergies>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
      "treeStep": "<mr/mr-ShapeTree#allergies>",
      "prefLabel": "allergies.",
      "definition": "allergies"
    },
    "mr/mr-ShapeTree#allergy": {
      "id": "<mr/mr-ShapeTree-SKOS#allergy>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
      "treeStep": "<mr/mr-ShapeTree#allergy>",
      "prefLabel": "allergy.",
      "definition": "allergy"
    },
    "mr/mr-ShapeTree#diagnosticTests": {
      "id": "<mr/mr-ShapeTree-SKOS#diagnosticTests>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
      "treeStep": "<mr/mr-ShapeTree#diagnosticTests>",
      "prefLabel": "diagnosticTests.",
      "definition": "diagnosticTests"
    },
    "mr/mr-ShapeTree#diagnosticTest": {
      "id": "<mr/mr-ShapeTree-SKOS#diagnosticTest>",
      "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
      "treeStep": "<mr/mr-ShapeTree#diagnosticTest>",
      "prefLabel": "diagnosticTest.",
      "definition": "diagnosticTest"
    }
  },
  "byScheme": {
    "mr/mr-ShapeTree-SKOS#containerManagement": [
      {
        "id": "<mr/mr-ShapeTree-SKOS#medicalRecords>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
        "treeStep": "<mr/mr-ShapeTree#medicalRecords>",
        "prefLabel": "Medical Records",
        "definition": "A collection of Medical Records"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#patients>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
        "treeStep": "<mr/mr-ShapeTree#patients>",
        "prefLabel": "Patients.",
        "definition": "Describes a receiver of medical care"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#appointments>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
        "treeStep": "<mr/mr-ShapeTree#appointments>",
        "prefLabel": "Appointments.",
        "definition": "A time and place with someone"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#conditions>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
        "narrower": [
          "<mr/mr-ShapeTree-SKOS#prescriptions>",
          "<mr/mr-ShapeTree-SKOS#allergies>"
        ],
        "treeStep": "<mr/mr-ShapeTree#conditions>",
        "prefLabel": "Conditions.",
        "definition": "A diagnosed issue"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#prescriptions>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
        "treeStep": "<mr/mr-ShapeTree#prescriptions>",
        "prefLabel": "prescriptions.",
        "definition": "prescriptions"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#allergies>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
        "treeStep": "<mr/mr-ShapeTree#allergies>",
        "prefLabel": "allergies.",
        "definition": "allergies"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#diagnosticTests>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#containerManagement>",
        "treeStep": "<mr/mr-ShapeTree#diagnosticTests>",
        "prefLabel": "diagnosticTests.",
        "definition": "diagnosticTests"
      }
    ],
    "mr/mr-ShapeTree-SKOS#instanceManagement": [
      {
        "id": "<mr/mr-ShapeTree-SKOS#medicalRecord>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
        "treeStep": "<mr/mr-ShapeTree#medicalRecord>",
        "prefLabel": "Medical Record",
        "definition": "An extensive view of your medical history"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#patient>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
        "treeStep": "<mr/mr-ShapeTree#patient>",
        "prefLabel": "Patient",
        "definition": "Describes a receiver of medical care"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#appointment>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
        "treeStep": "<mr/mr-ShapeTree#appointment>",
        "prefLabel": "Appointment.",
        "definition": "A time and place with someone"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#condition>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
        "narrower": [
          "<mr/mr-ShapeTree-SKOS#prescription>",
          "<mr/mr-ShapeTree-SKOS#allergy>"
        ],
        "treeStep": "<mr/mr-ShapeTree#condition>",
        "prefLabel": "Condition.",
        "definition": "A diagnosed issue"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#prescription>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
        "treeStep": "<mr/mr-ShapeTree#prescription>",
        "prefLabel": "prescription.",
        "definition": "prescription"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#allergy>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
        "treeStep": "<mr/mr-ShapeTree#allergy>",
        "prefLabel": "allergy.",
        "definition": "allergy"
      },
      {
        "id": "<mr/mr-ShapeTree-SKOS#diagnosticTest>",
        "inScheme": "<mr/mr-ShapeTree-SKOS#instanceManagement>",
        "treeStep": "<mr/mr-ShapeTree#diagnosticTest>",
        "prefLabel": "diagnosticTest.",
        "definition": "diagnosticTest"
      }
    ]
  }
}
