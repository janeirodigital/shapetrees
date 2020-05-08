const Fse = require('fs-extra');
const Path = require('path');
const Fetch = require('../filesystems/fetch-self-signed')(require('node-fetch'));
// const expect = require('chai').expect;
const chai = require('chai')
const chaiAsPromised = require('chai-as-promised')
const expect = chai.expect
chai.use(chaiAsPromised)
const RdfSerialization = require('../shapetree.js/lib/rdf-serialization')
const Errors = require('../shapetree.js/lib/rdf-errors');

const C = require('../shapetree.js/lib/constants');
const H = require('./test-harness');
let ShapeTree = null;
const TestRoot = H.LdpConf.documentRoot;

// initialize servers
H.init(TestRoot).then(() => ShapeTree = H.ShapeTree);
it('LDP server should serve /', () => { Fetch(H.getLdpBase()); }); // keep these test before the outer describe
it('AppStore server should serve /', () => { Fetch(H.getAppStoreBase()); });

describe(`test/local.test.js`, function () { // disable with xdescribe for debugging
describe('AppStore server', function () {
  it('should return on empty path', async () => {
    const resp = await Fetch(H.getAppStoreBase());
    const text = await resp.text();
    expect(JSON.parse(text)).to.be.an('array');
  });
  it('should resolve full path', async () => {
    const resp = await Fetch(new URL('cal/Calendar.shex', H.getAppStoreBase()));
    const text = await resp.text();
    expect(text).match(/^PREFIX/);
  });
});

describe('ShapeTree.local', function () {
  it('should throw if not passed a URL', () => {
    expect(() => {
      new ShapeTree.local('http://localhost/', '/');
    }).throw();
  });
});

describe('ShapeTree.managedContainer', () => {
  it('should throw if not passed a Container URL', () => {
    expect((async () => {
      return new ShapeTree
        .managedContainer('http://localhost/', '/', "construct dir with URL string").ready;
    })()).to.be.eventually.rejectedWith('must be an instance of URL').and.be.an.instanceOf(Error);
  });
  it('should throw if the Container URL doesn\'t end with \'/\'', () => {
    expect((async () => {
      await new ShapeTree
        .managedContainer(new URL('http://localhost/foo'), '/', "construct dir without trailing '/'").ready;
    })()).to.be.eventually.rejectedWith('must end with \'/\'').and.be.an.instanceOf(Error);
  });
  it('should throw if the Container URL ends with \'//\'', () => {
    expect((async () => {
      await new ShapeTree
        .managedContainer(new URL('http://localhost/foo//'), '/', "construct dir trailing '//'").ready;
    })()).to.be.eventually.rejectedWith('ends with \'//\'').and.be.an.instanceOf(Error);
  });
  it('should throw if the shapeTree parameter isn\'t a URL', () => {
    expect((async () => {
      await new ShapeTree
        .managedContainer(new URL('http://localhost/foo/'), '/', "construct dir with URL string shapeTree", 'http://localhost/shapeTree', '.').ready;
    })()).to.be.eventually.rejectedWith('shapeTree must be an instance of URL').and.be.an.instanceOf(Error);
  });
  it('should remove a Container directory', async () => {
    const delme = 'delme/';
    const c = await new ShapeTree
          .managedContainer(new URL(delme, new URL(H.getLdpBase())), "this should be removed from filesystem", new URL(new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())), '.').ready;
    expect(Fse.statSync(Path.join(TestRoot, 'delme')).isDirectory()).to.be.true;
    Fse.readdirSync(Path.join(TestRoot, delme)).forEach(
      f =>
        Fse.unlinkSync(Path.join(TestRoot, delme, f))
    );
    Fse.rmdirSync(Path.join(TestRoot, delme)); // c.remove();
    expect(()=> {Fse.statSync(Path.join(TestRoot, 'delme'));}).to.throw(Error);
  });
  rej('should fail on an invalid shapeTree graph', // rejects.
      async () => {
        const c = await new ShapeTree
              .managedContainer(new URL('/', new URL(H.getLdpBase())), "this should not appear in filesystem", new URL(new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())), '.').ready;
        c.graph.getQuads(c.url.href, C.ns_tree + 'shapeTreeRoot', null).forEach(q => c.graph.removeQuad(q)) // @@should use RDFJS terms
        await c.getRootedShapeTree(H.LdpConf.cache);
      },
      err => expect(err).to.be.an('Error').that.matches(/no matches/)
     );
});

describe('ShapeTree.remote', function () {
  it('should throw if not passed a URL', () => {
    expect(
      () => // throws immedidately.
        new ShapeTree.remoteShapeTree(new URL('cal/GoogleShapeTree#top', H.getAppStoreBase()).href).fetch()
    ).throw(Error);
  });
  rej('should throw on a GET failure', // rejects.
      () => new ShapeTree.remoteShapeTree(new URL(new URL('doesnotexist/', H.getAppStoreBase()))).fetch(),
      err => expect(err).to.be.an('Error')
     );
  it('should parse turtle', async () => {
    const r = await new ShapeTree.remoteShapeTree(new URL('gh/ghShapeTree.ttl#root', H.getAppStoreBase())).fetch();
    expect(r.graph.size).to.be.above(10);
  })
  rej('should throw on bad media type',
      () => new ShapeTree.remoteShapeTree(new URL('gh/ghShapeTree.txt#root', H.getAppStoreBase())).fetch(),
      err => expect(err).to.be.an('Error')
     );
});

describe('ShapeTree.validate', function () {
  rej('should throw if shapeTree step is missing a shape',
      () => {
        const f = new ShapeTree.remoteShapeTree(new URL(new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())));
        return f.fetch().then(
          () => f.validate(new URL('doesnotexist', H.getAppStoreBase()), "text/turtle", "", new URL("http://a.example/"), "http://a.example/")
      )},
      err => expect(err).to.be.an('Error')
     );
  rej('should throw on malformed POST Turtle body',
      () => {
        const f = new ShapeTree.remoteShapeTree(new URL(new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())));
        return f.fetch().then(
          () => f.validate(new URL('cal/GoogleShapeTree#Event', H.getAppStoreBase()), 'text/turtle', 'asdf', new URL('http://a.example/'))
      )},
      err => expect(err).to.be.an('Error')
     );
  rej('should throw on malformed POST JSON-LD body',
      () => {
        const f = new ShapeTree.remoteShapeTree(new URL(new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())));
        return f.fetch().then(
          () => f.validate(new URL('cal/GoogleShapeTree#Event', H.getAppStoreBase()), 'application/json', 'asdf', new URL('http://a.example/'))
      )},
      err => expect(err).to.be.an('Error')
     );
});

describe('ShapeTree misc', function () {
  it('should construct all errors', () => {
    expect(new Errors.UriTemplateMatchError('asdf')).to.be.an('Error');
    expect(new Errors.ShapeTreeStructureError('asdf')).to.be.an('Error');
  });
  it('should render RDFJS nodes', () => {
    const iri = 'http://a.example/';
    expect(RdfSerialization.renderRdfTerm({termType: 'NamedNode', value: iri})).to.equal(`<${iri}>`);
    const bnode = 'b1';
    expect(RdfSerialization.renderRdfTerm({termType: 'BlankNode', value: bnode})).to.equal(`_:${bnode}`);
    const literal = '"This statement is a lie" is a lie.';
    expect(RdfSerialization.renderRdfTerm({termType: 'Literal', value: literal})).to.equal(`"${literal.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    expect(() => RdfSerialization.renderRdfTerm(12345)).throw(Error);
    expect(() => RdfSerialization.renderRdfTerm({a:1})).throw(Error);
  })
});

describe('STOMP', function () {

  // { @@ duplicated in bad.test.js but testing specific error messages is inappropriate there.
  it('should fail with bad Turtle', async () => {
    const link = ['<http://www.w3.org/ns/ldp#Container>; rel="type"',
                  `<${new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())}>; rel="shapeTree"`];
    const registration = '@prefix x: <>\n@@bad Turtle@@';
    const resp = await H.trySend(H.getLdpBase().href, link, 'ShouldNotExist', registration);
    expect(resp.statusCode).to.deep.equal(422)
    expect(resp.type).to.deep.equal('application/json');
    const err = JSON.parse(resp.text);
    expect(err.message).match(/Unexpected "@@bad" on line 2/)
  });

  it('should fail with bad JSON', async () => {
    const link = ['<http://www.w3.org/ns/ldp#Container>; rel="type"',
                  `<${new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())}>; rel="shapeTree"`];
    const registration = '{\n  "foo": 1,\n  "bar": 2\n@@bad JSON}';
    const resp = await H.trySend(H.getLdpBase().href, link, 'ShouldNotExist', registration, 'application/ld+json');
    // resp.statusCode = H.dumpStatus(resp);
    expect(resp.statusCode).to.deep.equal(422)
    expect(resp.type).to.deep.equal('application/json');
    const err = JSON.parse(resp.text);
    expect(err.message).match(/Unexpected token @/)
  });

  it('should fail with bad JSONLD', async () => {
    const link = ['<http://www.w3.org/ns/ldp#Container>; rel="type"',
                  `<${new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())}>; rel="shapeTree"`];
    const registration = '{\n  "foo": 1,\n  "@id": 2\n}';
    const resp = await H.trySend(H.getLdpBase().href, link, 'ShouldNotExist', registration, 'application/ld+json');
    expect(resp.statusCode).to.deep.equal(422);
    expect(resp.type).to.deep.equal('application/json');
    const err = JSON.parse(resp.text);
    expect(resp.text).match(/jsonld.SyntaxError/);
  });
  // }

  const installDir = 'collisionDir';
  const location = `${Path.join('/', installDir, '/')}collision-2/`;
  before(() => H.ensureTestDirectory(installDir, TestRoot));
  it('should create a novel directory', async () => {


    const mkdirs = [`${installDir}/collision`, `${installDir}/collision-1`];
    mkdirs.forEach(d => Fse.mkdirSync(Path.join(TestRoot, d)));
    const link = ['<http://www.w3.org/ns/ldp#Container>; rel="type"',
                  `<${new URL('cal/GoogleShapeTree#top', H.getAppStoreBase())}>; rel="shapeTree"`];
    const registration = `PREFIX ldp: <http://www.w3.org/ns/ldp#>
[] ldp:app <http://store.example/gh> .
<http://store.example/gh> ldp:name "CollisionTest" .
`;
    const resp = await H.trySend(H.getLdpBase().href + Path.join(installDir, '/'), link, 'collision', registration, 'text/turtle');
    mkdirs.forEach(d => Fse.rmdirSync(Path.join(TestRoot, d)));
    if (!resp.ok) resp.ok = H.dumpStatus(resp);
    expect(resp.ok).to.deep.equal(true);
    expect(new URL(resp.headers.location).pathname).to.deep.equal(location);
    expect(resp.statusCode).to.deep.equal(201);
    expect(resp.text).match(new RegExp(`tree:shapeTreeInstancePath <collision-2/>`))
  });

  describe(`create ${location}Events/09abcdefghijklmnopqrstuvwx_20200107T140000Z`, () => {
    H.post({path: `${location}Events/`, slug: '09abcdefghijklmnopqrstuvwx_20200107T140000Z.ttl',
            body: 'test/cal/09abcdefghijklmnopqrstuvwx_20200107T140000Z.ttl', root: {'@id': '09abcdefghijklmnopqrstuvwx_20200107T140000Z'},
            type: 'Resource', location: `${location}Events/09abcdefghijklmnopqrstuvwx_20200107T140000Z.ttl`});
    H.find([
      {path: `${location}Events/09abcdefghijklmnopqrstuvwx_20200107T140000Z.ttl`, accept: 'text/turtle', entries: ['start', 'end']},
    ]);
    H.dontFind([
      {path: `${location}Events/19abcdefghijklmnopqrstuvwx_20200107T140000Z.ttl`, accept: 'text/turtle', entries: ['collision-2/Events/19abcdefghijklmnopqrstuvwx_20200107T140000Z.ttl']},
    ]);

    it('should delete a file', async () => {
      const resp = await H.tryDelete(`${location}Events/09abcdefghijklmnopqrstuvwx_20200107T140000Z.ttl`);
      expect(resp.ok).to.be.true;
    });

    it('should delete the novel directory', async () => {
      const resp = await H.tryDelete(location);
      expect(resp.ok).to.be.true;
    });

    it('should delete the parent directory', async () => {
      const url = new URL(installDir + '/', H.getLdpBase());
      const resp = await H.tryDelete(url);
      expect(resp.ok).to.be.true;
    });
  });
});

  describe('handle PLANTs and POSTs with no Slug header', () => {
    let installDir = 'no-slug'
    before(() => H.ensureTestDirectory(installDir, TestRoot));
    describe(`create ${Path.join('/', installDir, '/')}Container/`, () => {
      H.stomp({path: Path.join('/', installDir, '/'),                 name: 'GhApp2', url: 'http://store.example/gh2', getShapeTree: () => new URL('gh/ghShapeTree#root', H.getAppStoreBase()),
               status: 201, location: `${Path.join('/', installDir, '/')}Container/`})
      H.find([
        {path: `${Path.join('/', installDir, '/')}Container/`, accept: 'text/turtle', entries: ['shapeTreeInstancePath "."']},
      ])
    });
    describe(`re-create ${Path.join('/', installDir, '/')}Container/`, () => {
      H.stomp({path: Path.join('/', installDir, '/'), slug: '999',    name: 'GhApp2', url: 'http://store.example/gh2', getShapeTree: () => new URL('gh/ghShapeTree#root', H.getAppStoreBase()),
               status: 201, location: `${Path.join('/', installDir, '/')}Container/`})
      H.dontFind([
        {path: `${Path.join('/', installDir, '/')}999/`, accept: 'text/turtle', entries: [`/${installDir}/999/`]},
      ])
    });
    describe(`create ${Path.join('/', installDir, '/')}Container/users/Container/`, () => {
      H.post({path: `${Path.join('/', installDir, '/')}Container/users/`,                type: 'Container',
              body: 'test/gh/alice.json', mediaType: "application/ld+json", root: {'@id': '#alice'},
              parms: {userName: 'alice'}, location: `${Path.join('/', installDir, '/')}Container/users/Container/`});
      H.find([
        {path: `${Path.join('/', installDir, '/')}Container/users/Container/`, accept: 'text/turtle', entries: ['users/Container']},
      ])
    });
  });
/* disabled 'cause of race condition -- which test requires first?
describe('LDP server', function () {
  it('should leave existing root in-place', () => {
    Fse.removeSync(TestRoot);
    new ShapeTree.dir(new URL('http://localhost/'), '/', TestRoot, "test root")
    Fse.writeFileSync(Path.join(TestRoot, 'foo'), 'test file', {encoding: 'utf8'})
    expect(Fse.readFileSync(Path.join(TestRoot, 'foo'), 'utf8')).to.deep.equal('test file')
    const ldpServer = require('../servers/LDP')
    expect(Fse.readFileSync(Path.join(TestRoot, 'foo'), 'utf8')).to.deep.equal('test file')

    // restore 'cause modules are required only once.
    Fse.removeSync(TestRoot);
    ldpServer.initializeFilesystem()
  })
})
*/

});

/**
 * test for rejction
 * try with:
  rej(
    'example invocation of rej',
    () => new Promise((resolve, reject) => reject(Error(1))), // or reject(1) (fails) or resolve(X) (fails)
    err => expect(err).to.be.an('error')
  )
*/
function rej (msg, run, test) {
  it(msg, () => run().then(
    ret => {
      throw Error('expected to reject but resolved with ' + ret);
    },
    err => {
      try {
        test(err)
      } catch (e) {
        throw e
      }
    }
  ));
}

function xrej (run, test) {
  xit(run, () => true)
}
