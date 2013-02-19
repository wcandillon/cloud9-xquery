/**
 * XQuery linter worker.
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {

    var completeUtil = require("ext/codecomplete/complete_util");
    var xqCompletion = require('ext/xquery/xquery_completion');
    var baseLanguageHandler = require('ext/language/base_handler');
    var XQueryParser = require('ext/xquery/lib/XQueryParser').XQueryParser;
    var JSONParseTreeHandler = require('ext/xquery/lib/JSONParseTreeHandler').JSONParseTreeHandler;
    var CodeFormatter = require('ext/xquery/lib/visitors/CodeFormatter').CodeFormatter;
    var Compiler = require('ext/xquery/lib/Compiler').Compiler;
    var Utils = require('ext/xquery/lib/utils').Utils;
    // var XQueryResolver = require('ext/xquery/quickfix/XQueryResolver').XQueryResolver; // Waiting for quickfix integration
    var Refactoring = require('ext/xquery/refactoring').Refactoring;
    
    var handler = module.exports = Object.create(baseLanguageHandler);

    var builtin = null;
    var schemas = null;
    
    var paths = [];
    
    handler.init = function(callback) {
      handler.sender.on("updateFileCache", function(event) {
        paths = event.data.split("\n");
      });
      callback();  
    };

    handler.handlesLanguage = function(language) {
        return language === 'xquery';
    };

    handler.parse = function(code, callback) {
        var compiler = new Compiler();
        var ast = compiler.compile(code);
        callback(ast);
    };

    handler.isParsingSupported = function() {
        return true;
    };

    handler.findNode = function(ast, pos, callback) {
        callback(Utils.findNode(ast, pos));
    };

    handler.getPos = function(node, callback) {
        callback(node.pos);
    };

    handler.analyze = function(doc, ast, callback) {
                
        if(builtin === null) {
          var text = completeUtil.fetchText('/static', 'ext/xquery/lib/builtin.json'); // TODO staticprefix is hardcoded here!
          builtin = JSON.parse(text);  
          if (!builtin){
              throw "Failed to init builtin @analyze, this.staticPrefix=" + this.staticPrefix;
          }
        }
        
        callback(handler.analyzeSync(doc, ast, builtin));
    };

    handler.analyzeSync = function(doc, ast, builtin) {
        var markers = ast.markers;
        
        // Generate resolutions
        // Commented out on purpose - waiting for quickfix extension to be 
        // integrated into cloud9
        /*
        var resolver = new XQueryResolver(ast);
        markers.forEach(function(curMarker){
            curMarker.resolutions = resolver.getResolutions(curMarker, builtin);
        });
        */
        
        var error = ast.error;
        //If syntax error, don't show warnings?
        return markers;
    };

    handler.outline = function(doc, ast, callback) {
        if (!ast) return callback();
        callback({
            body: ast.outline
        });
    };

    handler.complete = function(doc, fullAst, pos, currentNode, callback) {

        
        if(builtin === null) {
          var text = completeUtil.fetchText(this.staticPrefix, 'ext/xquery/lib/builtin.json');
          builtin = JSON.parse(text); 
        }
        
        if(schemas === null) {
          var text = completeUtil.fetchText(this.staticPrefix, 'ext/xquery/lib/schemas.json');
          schemas = JSON.parse(text);  
        }
        
        var line = doc.getLine(pos.row);
        
        if(currentNode !== undefined && currentNode.name === "URILiteral" && currentNode.getParent && currentNode.getParent.name === "SchemaImport") {
            var p = currentNode.getParent;
            var idx = 0;
            for(var i=0; i < p.children.length; i++) {
              var child = p.children[i];
              if(child.pos.sl === currentNode.pos.sl && child.pos.sc === currentNode.pos.sc &&
                 child.pos.el === currentNode.pos.el && child.pos.ec === currentNode.pos.ec) {
                if(idx > 0) {
                  callback(xqCompletion.completePath(line, pos, paths));
                } else {
                  callback(xqCompletion.completeSchemaURI(line, pos, schemas));
                }
              } else if(child.name === "URILiteral") {
                idx++;
              }
            }
        } else if (currentNode !== undefined && currentNode.name === "URILiteral" && currentNode.getParent) {
            var p = currentNode.getParent;
            var idx = 0;
            for(var i=0; i < p.children.length; i++) {
              var child = p.children[i];
              if(child.pos.sl === currentNode.pos.sl && child.pos.sc === currentNode.pos.sc &&
                 child.pos.el === currentNode.pos.el && child.pos.ec === currentNode.pos.ec) {
                if(idx > 0) {
                  callback(xqCompletion.completePath(line, pos, paths));
                } else {
                  callback(xqCompletion.completeURI(line, pos, builtin));
                }
              } else if(child.name === "URILiteral") {
                idx++;
              }
            }
        }
        else {
            callback(xqCompletion.completeExpr(line, pos, builtin, fullAst));
        }
        
    };

    /**
     * Invoked when an automatic code formating is wanted
     * @param doc the Document object repersenting the source
     * @return a string value representing the new source code after formatting or null if not supported
     */
    handler.codeFormat = function(doc, callback) {
        var code = doc.getValue();
        var h = new JSONParseTreeHandler(code);
        var parser = new XQueryParser(code, h);
        parser.parse_XQuery();
        var ast = h.getParseTree();
        var codeFormatter = new CodeFormatter(ast);
        var formatted = codeFormatter.format();
        callback(formatted);
    };

    handler.onCursorMovedNode = function(doc, fullAst, cursorPos, currentNode, callback) {
        if (!fullAst || !currentNode) { return callback(); }

        var markers = [];
        var enableRefactorings = [];
        //Is it a QName prefix?
        if (Refactoring.isNodePrefix(currentNode, cursorPos) || Refactoring.isNSDecl(currentNode, cursorPos)) {
            enableRefactorings.push("renameVariable");
            var value = Refactoring.isNSDecl(currentNode, cursorPos) ? currentNode.value : currentNode.value.substring(0, currentNode.value.indexOf(":"));
            var decl = Refactoring.findPrefixDeclaration(value, fullAst);
            var refs = Refactoring.findPrefixReferences(value, fullAst);
            if(decl !== undefined) {
              markers.push({
                pos: decl,
                type: "occurrence_main"
              });
            }
            
            for(var i = 0; i < refs.length; i++) {
              var ref = refs[i];
              markers.push({
                pos: ref,
                type: "occurrence_other"
              });
            }
        }
        //Is it a Function name?
        else if(Refactoring.isFunctionDecl(currentNode) || Refactoring.isFunctionCall(currentNode)) {
            enableRefactorings.push("renameVariable");
            var declAndRefs = Refactoring.getFunctionDeclarationsAndReferences(fullAst, currentNode.value, currentNode.getParent.arity);
            var declaration = declAndRefs.declaration;
            var references  = declAndRefs.references;
            if(declaration !== null) {
              markers.push({
                pos: declaration,
                type: "occurrence_main"
              });
            }
           for (var i=0; i < references.length; i++) {
              var pos = references[i];
              markers.push({
                  pos: pos,
                  type: "occurrence_other"
              });
           }            
        }
        //Is it a Tag name?
        else if(Refactoring.isTagName(currentNode)) {
          enableRefactorings.push("renameVariable");
          var tags = Refactoring.getTags(currentNode.getParent);
          if(tags.close) {
            markers.push({
              pos: tags.close,
              type: "occurrence_other"
            });
          }
          if(tags.open) {
            markers.push({
              pos: tags.open,
              type: "occurrence_main"
            });
          }
        }
        //Is it a variable name?
        else if(Refactoring.isVariable(currentNode)) {
          enableRefactorings.push("renameVariable");
          var name = currentNode.value;
          var sctx = fullAst.sctx;
          var currentSctx = Utils.findNode(sctx, {
            line: cursorPos.row,
            col: cursorPos.column
          });

          var varRefs = currentSctx.getVarRefs(name) || [];
          for (var i=0; i < varRefs.length; i++) {
            var varRef = varRefs[i];
            markers.push({
                pos: varRef.pos,
                type: "occurrence_other"
            });
          }
          
          var varDecl = currentSctx.getVarDecl(name);
          if (varDecl) {
            markers.push({
                pos: varDecl.pos,
                type: "occurrence_main"
            });
          }
        }
        //console.log(markers);
        callback({
            markers: markers,
            enableRefactorings: enableRefactorings
        });
    };
    
    handler.getVariablePositions = function(doc, fullAst, cursorPos, currentNode, callback) {
        if (!fullAst || !currentNode) { return callback(); }
        
        if (Refactoring.isNodePrefix(currentNode, cursorPos) || Refactoring.isNSDecl(currentNode, cursorPos)) {
            var nsDecl = Refactoring.isNSDecl(currentNode, cursorPos);
            var value =  nsDecl ? currentNode.value : currentNode.value.substring(0, currentNode.value.indexOf(":"));
            var decl = nsDecl ? currentNode.pos : Refactoring.findPrefixDeclaration(value, fullAst);
            var refs = Refactoring.findPrefixReferences(value, fullAst);

            var declarations = [];
            var uses = [];
            if(decl !== undefined) {
              declarations.push({ row: decl.sl, column: decl.sc });
            }
            
            for(var i = 0; i < refs.length; i++) {
              var ref = refs[i];
              uses.push({ row: ref.sl, column: ref.sc });
            }
            
            callback({
                length: nsDecl ?  currentNode.pos.ec - currentNode.pos.sc : currentNode.value.indexOf(":"),
                pos: {
                    row: currentNode.pos.sl,
                    column: currentNode.pos.sc
                },
                others: declarations.concat(uses),
                declarations: declarations,
                uses: uses
            });
        }
        //Is it a Function name?
        else if(Refactoring.isFunctionDecl(currentNode) || Refactoring.isFunctionCall(currentNode)) {
          var declAndRefs = Refactoring.getFunctionDeclarationsAndReferences(fullAst, currentNode.value, currentNode.getParent.arity);
          var declaration = declAndRefs.declaration;
          var references  = declAndRefs.references;
          var declarations = [];
          if(declaration !== null) {
             declarations.push({
              row: declaration.sl,
              column: declaration.sc
            });
          }
          var uses = [];
          for (var i = 0; i < references.length; i++) {
            var pos = references[i];
            uses.push({
              row: pos.sl,
              column: pos.sc
            });
          }
          callback({
            length: currentNode.pos.ec - currentNode.pos.sc,
            pos: {
                row: currentNode.pos.sl,
                column: currentNode.pos.sc
            },
            others: declarations.concat(uses),
            declarations: declarations,
            uses: uses
          });
        }
        //Is it a Tag name?
        else if(Refactoring.isTagName(currentNode)) {
          var tags = Refactoring.getTags(currentNode.getParent);
          var declarations = [];
          var uses = [];
          if(tags.open !== undefined) {
            declarations.push({
              row: tags.open.sl,
               column: tags.open.sc
            });
          }
          if(tags.close !== undefined) {
            uses.push({
              row: tags.close.sl,
              column: tags.close.sc
            });
              
          }
          callback({
            length: currentNode.pos.ec - currentNode.pos.sc,
            pos: {
                row: currentNode.pos.sl,
                column: currentNode.pos.sc
            },
            others: declarations.concat(uses),
            declarations: declarations,
            uses: uses
          });
        }
        //Is it a variable name?
        else if(Refactoring.isVariable(currentNode)) {
          var name = currentNode.value;
          var sctx = fullAst.sctx;
          var currentSctx = Utils.findNode(sctx, {
            line: cursorPos.row,
            col: cursorPos.column
          });

          var varRefs = currentSctx.getVarRefs(name) || [];
          var uses = [];

          for (var i=0; i < varRefs.length; i++) {
            var varRef = varRefs[i];
            uses.push({
                row: varRef.pos.sl,
                column: varRef.pos.sc
            });
          }

          var varDecl = currentSctx.getVarDecl(name);
          var declarations = [];
          if(varDecl) {
            declarations.push({
              row: varDecl.pos.sl,
              column: varDecl.pos.sc
            });
          }

          callback({
            length: currentNode.pos.ec - currentNode.pos.sc,
            pos: {
                row: currentNode.pos.sl,
                column: currentNode.pos.sc
            },
            others: declarations.concat(uses),
            declarations: declarations,
            uses: uses
          });
        }
    };

});
