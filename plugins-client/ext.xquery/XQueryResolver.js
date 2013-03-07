
define(function(require, exports, module) {
"use strict";

// Needs quickfix integration
var markerResolution = require('ext/language/MarkerResolution').MarkerResolution;

// Visitors
var VariableRemover = require('./lib/visitors/VariableRemover.js').VariableRemover;
var NamespaceRemover = require('./lib/visitors/NamespaceRemover.js').NamespaceRemover;
var Renamer = require('./lib/visitors/Renamer.js').Renamer;
var Adder = require('./lib/visitors/Adder.js').Adder;


// TODO change to c9 quickfix images
var IMG_DELETE = './images/delete_obj.gif';
var IMG_ADD = './images/add_obj.gif';
var IMG_CHANGE = './images/correction_change.gif';

var NUM_NSRENAME_SUGGESTIONS = 5;

var RENAME = {
    name: 0,
    prefix: 1
};

var ADD = {
    NamespaceDecl: 0,
    ModuleImport: 1
};

/**
 * Resolver for xquery markers. getResolutions(marker) generates
 * MarkerResolutions for the given marker and returns them in a list
 */
var XQueryResolver = function(doc, ast){
    

    
    //-----------------------------------
    // UTILITY FUNCTIONS
    //-----------------------------------
    
    var memo = [];
    function levenshteinDistance(str1, i, len1, str2, j, len2) {
       var key = [i,len1,j,len2].join(',');
       if(memo[key] !== undefined) return memo[key];
       
       if(len1 === 0) return len2;
       if(len2 === 0) return len1;
       var cost = 0;
       if(str1[i] != str2[j]) cost = 1;
       
       var dist = Math.min(
           levenshteinDistance(str1, i+1,len1-1, str2,j,len2)+1, 
           levenshteinDistance(str1,i,len1,str2,j+1,len2-1)+1,
           levenshteinDistance(str1,i+1,len1-1,str2,j+1,len2-1)+cost);
       memo[key] = dist;
       return dist;
    }
    
    function lDistance(str1, str2){
        memo = [];
        return levenshteinDistance(str1, 0, str1.length, str2, 0, str2.length);
    }
    
    function astToText(node){
        if (node !== undefined){
            var resText = "";
            if (node.value !== undefined) {
                resText += node.value;
            }
            for (var i = 0; i < node.children.length; i++){
                resText += astToText(node.children[i]);
            }
            return resText;
        }else{
            return "";
        }
    }
    
    this.getModulesContainingFunction = function(fun){
        var ret = [];
        for (var module in this.builtin){
            if (this.moduleContainsFunction(module,fun)){
                ret[module] = this.builtin[module];
            }
        }
        return ret;
    };
    
    this.moduleContainsFunction = function(module, fun){
        return this.builtin.hasOwnProperty(module) &&
                this.builtin[module].functions.hasOwnProperty(fun);
    };
    
    this.getResolutions = function(marker, builtin){
        this.builtin = builtin;
        if (!this.builtin){
            this.builtin = {};
        }
        var name = marker.name;
        if (name){
            if (typeof this[name] === 'function'){
                return this[name](marker);
            }
        }
       return [];
    };
    
    //-----------------------------------
    // MARKER HANDLERS
    //-----------------------------------
    
    this.unusedVar = function(marker){
        var label = "Remove unused variable";
        var image = IMG_DELETE;
        var variable = marker.message.substring(0,marker.message.indexOf(":"));
        
        var remover = new VariableRemover(ast);
        var removedAst = remover.removeVar(marker.pos);
          
        var appliedContent = astToText(removedAst);
        var preview = "<b>Remove Unused Variable <i>" + variable + "</i><b>";
        return [markerResolution(label,image,preview,appliedContent)];
    };
    
    this.unusedNsPrefix = function(marker){
        var _self = this;
        var ret = [];
        
        // Resolution 1: Change unused namespace prefix to prefix that cannot be
        // expanded to URI (XPST0081)
        var unusedNs = marker.ns;
        ast.markers.forEach(function(mrk){
            // unusedPrefix = unusedNs
            // check for each XPST0081 (nonExpandablePrefix:localName) whether 
            // unusedNs contains localName, if so suggest to rename unusedPrefix
            // to nonExpandablePrefix
            if (mrk.name == "XPST0081"){
                var nonExpandablePrefix = mrk.prefix;
                var localName = mrk.localName;
                var preview = "<b>Rename Unused Namespace Prefix</b>";
                preview += "<br/><br/><i>import module namespace <b>" + nonExpandablePrefix + "</b> = \"" + unusedNs +'";</i>';
                if (_self.moduleContainsFunction(unusedNs, localName)){
                    // The unused namespace contains the required function, suggest to
                    // rename the unused prefix to the nonexpandable one
                    ret.push(_self.resRename(marker, 
                        "Rename prefix to " + nonExpandablePrefix,
                        nonExpandablePrefix, RENAME.name, preview));
                }
            }
        });
        
        // Resolution 2: Remove unused namespace prefix
        var label = "Remove unused namespace prefix";
        var image = IMG_DELETE;
        
        var remover = new NamespaceRemover(ast);
        var removedAst = remover.removeNs(marker.pos);
          
        var appliedContent = astToText(removedAst);
        var preview = "<b>Remove Unused Module Import</b>";
        preview += '<br/><br/><del><i>' + remover.getRemovedString() + '</del></i>';        
        ret.push(markerResolution(label,image,preview,appliedContent));
        return ret;
    };
    
    this.duplicateNs = this.XQST0033 = function(marker){
        var label = "Remove duplicate namespace prefix";
        var image = IMG_DELETE;
        
        var remover = new NamespaceRemover(ast);
        var removedAst = remover.removeNs(marker.pos);
          
        var appliedContent = astToText(removedAst);
        var preview = "<b>Remove Duplicate Namespace Prefix</b>";
        preview += "<br/><br/><i><del>" + remover.getRemovedString() + "</del></i>";
        return [markerResolution(label,image,preview,appliedContent)];
    };
    
    /** Can not expand namespace prefix to URI */
    this.XPST0081 = function(marker){
        var _self = this;
        
        var prefix = marker.prefix;
        var localName = marker.localName;
        
        // The modules known to contain the function to be called
        var containingModules = this.getModulesContainingFunction(localName);

        // Resolution 1: Change prefix to imported prefix
        var renames = [];
        var localRenames = [];
        var currentPrefixes = [];
        var currentNs = [];
        for (var curPrefix in ast.sctx.namespaces){
            if (ast.sctx.namespaces.hasOwnProperty(curPrefix)){
                currentPrefixes.push(curPrefix);
                currentNs.push(ast.sctx.namespaces[curPrefix]);
            }
        }

        currentPrefixes.forEach(function(curPrefix){
            if (!localRenames[curPrefix]){
                localRenames[curPrefix] = true;
                var preview = "<b>Change Namespace Prefix</b>";
                preview += "<br/><br/><i><b>" + curPrefix + "</b>:" + localName + "(...</i>";
                renames.push({
                   marker: marker,
                   label: "Change prefix to " + curPrefix,
                   preview: preview,
                   toName: curPrefix,
                   hasFunction: (containingModules.hasOwnProperty(ast.sctx.namespaces[curPrefix]) ? 1 : 0),
                   renameType: RENAME.prefix
                });
            }
        });        
        
        // Resolution 2: Rename existing module import
        var nsRenames = [];
        ast.markers.forEach(function(mrk){
            if (mrk.name == "unusedNamespace" && mrk.nsType === 'module'){
                var unusedPrefix = mrk.message.split('"')[1];
                if (!nsRenames[unusedPrefix]){
                    nsRenames[unusedPrefix] = true;
                    var preview = "<b>Rename Unused Namespace</b>";
                    preview += "<br/><br/><i>import module namespace <b>" + prefix + "</b> = \"" + mrk.ns +'";</i>';
                    renames.push({
                       marker: mrk,
                       label: 'Change unused namespace prefix "' + unusedPrefix +'" to '
                        + prefix,
                        preview: preview,
                       toName: prefix,
                       fromName: unusedPrefix,
                       hasFunction: (containingModules.hasOwnProperty(mrk.ns) ? 1 : 0),
                       renameType: RENAME.name
                    });
                }                
            }
        });
        
        // Sort the renames primarily by whether they contain the required
        // function, secondarily by the edit distance to the required prefix
        renames.sort(
            function(a,b){
                var hasFuncDist = b.hasFunction - a.hasFunction;
                if (hasFuncDist){
                    return hasFuncDist;
                }
                var compareA = a.fromName || a.toName;
                var compareB = b.fromName || b.toName;
                return lDistance(compareA,prefix) - lDistance(compareB,prefix);
            }
        );
        
        var renameResolutions = [];
        for (var i = 0; i < NUM_NSRENAME_SUGGESTIONS && i < renames.length &&
             renames[i].hasFunction; i++){
            var rename = renames[i];
            var resolution = this.resRename(rename.marker, rename.label, 
                                            rename.toName, rename.renameType, rename.preview);
            renameResolutions.push(resolution);
        }
        
                
        // Resolution 3: Add import / namespacedecl
        var addResolutions = [];
        //addResolutions.push(this.resDebug("debug", JSON.stringify(marker, null, 2)));
        
        // Add imports containing the function to be called
        for (var module in containingModules){
            if (containingModules.hasOwnProperty(module) 
                && currentNs.indexOf(module) == -1){
                addResolutions.push(this.resAddModuleImport(prefix, module));
            }
        }
        
        // Add unknown import with this prefix
        if (!addResolutions.length && !renameResolutions.length){
            addResolutions.push(this.resAddModuleImport(prefix, ""));
        }
                
        var ret = addResolutions;
        
        for (var i = 0; 
             i < NUM_NSRENAME_SUGGESTIONS && i < renameResolutions.length; i++){
                ret.push(renameResolutions[i]);
             }
        return ret;
    };
    
    
        
    //-----------------------------------
    // MarkerResolutions
    //-----------------------------------
    
    this.resRename = function(marker, label, toName, renameType, preview){
        var image = IMG_CHANGE;
        var renamer = new Renamer(ast);
        var newAst;

        switch (renameType){
            case RENAME.name:
                newAst = renamer.rename(marker.pos, toName);    
                break;
            case RENAME.prefix:
                newAst = renamer.renamePrefix(marker.pos, toName);
                break;
            default:
                throw "Illegal renameType";
        }
          
        var appliedContent = astToText(newAst);
        preview = preview || appliedContent;
        var ret = markerResolution(label,image,preview,appliedContent);
        ret.toName = toName;
        ret.renameType = renameType;
        return ret;
    };
    
    this.resAdd = function(label, node, addType){
        var image = IMG_ADD;
        var adder = new Adder(ast);
        var newAst, preview = "";
        
        switch(addType){
            case ADD.NamespaceDecl:
                newAst = adder.addNamespaceDecl(node);
                preview = "<b>Add Namespace Declaration</b>";
                preview += "<br/><br/><i>" + adder.getAddedString() + "</i>";
                break;
            case ADD.ModuleImport:
                newAst = adder.addModuleImport(node);
                preview = "<b>Add Module Import</b>";
                preview += "<br/><br/><i>" + adder.getAddedString() + "</i>";
                break;
            default:
                throw "Illegal addType";
        }
        
        var appliedContent = astToText(newAst);
        preview = preview || appliedContent;
        var ret = markerResolution(label,image,preview,appliedContent,newAst.cursorTarget);
        ret.addType = addType;
        return ret;
    };
    
    this.resAddNamespaceDecl = function(ncName, uriLiteral){
      var label = 'Declare Namespace ' + ncName;
      if (uriLiteral && uriLiteral.length){
          label += ' = "' + uriLiteral + '"';
      }
      uriLiteral = uriLiteral || "";
      var node = {
          NCName: ncName,
          URILiteral: uriLiteral
      };
      return this.resAdd(label, node, ADD.NamespaceDecl);
    };
    
    this.resAddModuleImport = function(ncName, uriLiterals){
      uriLiterals = uriLiterals || [];
      if (!(uriLiterals instanceof Array)){
          uriLiterals = [uriLiterals];
      }
      var label = 'Import Module ' + ncName;
      var node = {
          NCName: ncName,
          URILiterals: uriLiterals
      };
      
      return this.resAdd(label, node, ADD.ModuleImport);
    };
    
    this.resDebug = function(label, preview){
      return markerResolution(label, IMG_ADD, preview, preview);  
    };
 
    
};


exports.XQueryResolver = XQueryResolver;

}); 
