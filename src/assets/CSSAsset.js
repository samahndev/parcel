const Asset = require('../Asset');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const path = require('path');
const md5 = require('../utils/md5');
const postcssTransform = require('../transforms/postcss');

const URL_RE = /url\s*\(\"?(?![a-z]+:)/;
const IMPORT_RE = /@import/;
const PROTOCOL_RE = /^[a-z]+:/;

class CSSAsset extends Asset {
  constructor(name, pkg, options) {
    super(name, pkg, options);
    this.type = 'css';
  }

  mightHaveDependencies() {
    return IMPORT_RE.test(this.contents) || URL_RE.test(this.contents);
  }

  parse(code) {
    let root = postcss.parse(code, {from: this.name, to: this.name});
    return new CSSAst(code, root);
  }

  collectDependencies() {
    this.ast.root.walkAtRules('import', rule => {
      let params = valueParser(rule.params).nodes;
      let [name, ...media] = params;
      let dep;
      if (name.type === 'string') {
        dep = name.value;
      } else if (name.type === 'function' && name.value === 'url' && name.nodes.length) {
        dep = name.nodes[0].value;
      }

      if (!dep) {
        throw new Error('Could not find import name for ' + rule);
      }

      if (PROTOCOL_RE.test(dep)) {
        return;
      }

      media = valueParser.stringify(media).trim();
      this.addDependency(dep, {media});

      rule.remove();
      this.ast.dirty = true;
    });

    this.ast.root.walkDecls(decl => {
      if (URL_RE.test(decl.value)) {
        let parsed = valueParser(decl.value);
        let dirty = false;

        parsed.walk(node => {
          if (node.type === 'function' && node.value === 'url' && node.nodes.length) {
            let filename = node.nodes[0].value;
            if (!filename || PROTOCOL_RE.test(filename)) {
              return;
            }

            this.addDependency(filename);

            let resolved = path.resolve(path.dirname(this.name), filename);
            node.nodes[0].value = md5(resolved) + path.extname(filename);
            dirty = true;
          }
        });

        if (dirty) {
          decl.value = parsed.toString();
          this.ast.dirty = true;
        }
      }
    });
  }

  async transform() {
    await postcssTransform(this);
  }

  getCSSAst() {
    // Converts the ast to a CSS ast if needed, so we can apply postcss transforms.
    if (!(this.ast instanceof CSSAst)) {
      this.ast = CSSAsset.prototype.parse.call(this, this.ast.render());
    }

    return this.ast.root;
  }

  generate() {
    let css = this.ast ? this.ast.render() : this.contents;

    let js = '';
    if (this.cssModules) {
      js = 'module.exports = ' + JSON.stringify(this.cssModules, false, 2) + ';';
    }

    return {css, js};
  }
}

class CSSAst {
  constructor(css, root) {
    this.css = css;
    this.root = root;
    this.dirty = false;
  }

  render() {
    if (this.dirty) {
      this.css = '';
      postcss.stringify(this.root, c => this.css += c);
    }

    return this.css;
  }
}

module.exports = CSSAsset;