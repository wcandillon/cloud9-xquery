/**
 * Cloud9 Language Foundation
 *
 * @copyright 2011, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {

  var ext = require("core/ext");
  var ide = require("core/ide");
  var editors = require("ext/editors/editors");
  var language = require("ext/language/language");

  var filelist = require("ext/filelist/filelist");
  //var code = require("ext/code/code");
  var commands = require("ext/commands/commands");

  var commands = require("ext/commands/commands");
  var XQueryParser = require('./lib/XQueryParser.js').XQueryParser;
  var JSONParseTreeHandler = require('./lib/JSONParseTreeHandler.js').JSONParseTreeHandler;
  var CodeFormatter = require('./lib/visitors/CodeFormatter.js').CodeFormatter;

  module.exports = ext.register("ext/xquery/xquery", {
    name    : "XQuery Language Support",
    dev     : "28msec",
    type    : ext.GENERAL,
    deps    : [editors, language],
    nodes   : [],
    alone   : true,

    hook: function() {
      var _self = this;


      language.registerLanguageHandler(
        'xquery-worker',
        require('./xquery-worker-built-wrapped.js'));

      /*
         ide.addEventListener("extload", this.$extLoad = function(){
         _self.updateFileCache();
         });

         ide.addEventListener("newfile", this.$newFile = function() {
         _self.updateFileCache(true);
         });

         ide.addEventListener("removefile", this.$removeFile = function() {
         _self.updateFileCache(true);
         });

*/

      commands.addCommand({
        name: "beautify",
      hint: "reformat selected XQuery code in the editor",
      msg: "Beautifying selection.",
      bindKey: {mac: "Command-Shift-X", win: "Shift-Ctrl-X"},
      isAvailable : function(editor){
        if (editor && editor.path == "ext/code/code") {
          return true;
        }
        return false;
      },
      exec: function (editor) {
              _self.beautify(editor);
            }
      });

    },

    updateFileCache : function(isDirty){
                        filelist.getFileList(isDirty, function(data, state){
                          if (state != apf.SUCCESS)
                          return;
                        language.worker.emit("updateFileCache", { data: data });
                        });       
                      },

    beautify: function(editor) {
                var code = editor.getDocument().getValue();
                var h = new JSONParseTreeHandler(code);
                var parser = new XQueryParser(code, h); 
                parser.parse_XQuery();
                var ast = h.getParseTree();
                var codeFormatter = new CodeFormatter(ast);
                var formatted = codeFormatter.format();
                editor.getDocument().setValue(formatted);
              },


    init: function(amlNode) {

          },

    enable : function() {


             },

    disable : function() {
              },

    destroy : function() {
              }


  });

});
