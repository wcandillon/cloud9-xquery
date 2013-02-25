/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 * 
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */
 
define(function(require, exports, module){
  exports.Refactoring = {
    
    equalPositions: function(node1, node2) {
      return node1.pos.sl === node2.pos.sl &&
             node1.pos.sc === node2.pos.sc &&
             node1.pos.el === node2.pos.el &&
             node1.pos.ec === node2.pos.ec;
    },
    
    nsDecls: ["NamespaceDecl", "ModuleDecl", "SchemaPrefix", "ModuleImport"],
    
    findPrefixDeclaration: function (prefix, node) {
      if(node.name === "NCName" && node.value === prefix && node.getParent && node.getParent.getParent && this.nsDecls.indexOf(node.getParent.getParent.name) !== -1) {
        return node.pos;      
      }
      for(var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        var pos = this.findPrefixDeclaration(prefix, child);
        if(pos !== undefined) {
          return pos;        
        }
      }
    },
    
    findPrefixReferences: function (prefix, node) {
      var references = [];
      if(["QName", "Wildcard"].indexOf(node.name) !== -1 && node.value.indexOf(":") !== -1 && node.value.substring(0, node.value.indexOf(":")) === prefix) {
        var idx = node.value.indexOf(":");
        var pos = node.pos;
        references.push({ sl: pos.sl, sc: pos.sc, el: pos.el, ec: pos.sc + idx });  
      } else if(node.name === "EQName" && node.value && node.value.substring(0, 2) !== "Q{" && node.value.indexOf(":") !== -1 && 
        node.value.substring(0, node.value.indexOf(":")) === prefix) {
        var idx = node.value.indexOf(":");
        var pos = node.pos;
        references.push({ sl: pos.sl, sc: pos.sc, el: pos.el, ec: pos.sc + idx });  
      }
      for(var i = 0; i < node.children.length; i++) {
        var child = node.children[i];
        references = references.concat(this.findPrefixReferences(prefix, child));
      }
      return references;
    },
    
    isNodePrefix: function(currentNode, cursorPos){
      return ["EQName", "QName"].indexOf(currentNode.name) !== -1
          && currentNode.value.indexOf(":") !== -1
          && (currentNode.pos.sc + currentNode.value.indexOf(":") >= cursorPos.column);
    },
    
    isNSDecl: function(currentNode, cursorPos){
      return currentNode.name === "NCName" && currentNode.getParent && currentNode.getParent.getParent && this.nsDecls.indexOf(currentNode.getParent.getParent.name) !== -1;
    },
    
    isFunctionDecl: function(currentNode){
      return currentNode.name === "EQName" &&
             currentNode.getParent && currentNode.getParent.name === "FunctionDecl";
    },
    
    isFunctionCall: function(currentNode) {
      return currentNode.name === "EQName" &&
             currentNode.getParent &&
             currentNode.getParent.name === "FunctionCall";
    },
    
    isTagName: function(currentNode) {
      return currentNode.name === "QName" && currentNode.getParent && currentNode.getParent.name === "DirElemConstructor";    
    },
    
    isVariable: function(currentNode) {
      var parent = currentNode.getParent;
      if(!parent) return false;
      if(parent.name === "VarName") return true;
      for(var i = 0; i < parent.children.length - 1; i++) {
        var child = parent.children[i];
        var nextChild = parent.children[i + 1];
        if(child.value === "$" && nextChild.name === "EQName" &&
           this.equalPositions(nextChild, currentNode)) {
          return true;
        }
      }
      return false;
    },
    
    getFunctionDeclarationsAndReferences: function(ast, name, arity) {
      var hasDecl = ast.sctx.declaredFunctions[name] && ast.sctx.declaredFunctions[name][arity];
      var hasReferences = ast.sctx.functionReferences[name] && ast.sctx.functionReferences[name][arity];
      var declaration = hasDecl ? ast.sctx.declaredFunctions[name][arity] : null;
      var references  = hasReferences ? ast.sctx.functionReferences[name][arity] : [];
      return {
        declaration: declaration,
        references: references
      };
    },
    
    getTags: function(dirElemConstructor) {
        var result = {};
        for (var i = 0; i < dirElemConstructor.children.length; i++) {
            var child = dirElemConstructor.children[i];
            if (child.name === "QName") {
                if (result.open !== undefined) {
                    result.close = child.pos;
                }
                else {
                    result.open = child.pos;
                }
            }
        }
        return result;
    }
  };
});