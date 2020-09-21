/*!
* ISNode Blackrock Error Handler Module
*
* Copyright (c) 2020 Darren Smith
* Licensed under the LGPL license.
*/

;!function(undefined) {





	/** Create parent event emitter object from which to inherit ismod object */
	var isnode, ismod, log, errorCount = 0, errorMessages = {}, pipelines = {}, streamFns = {}, lib, rx, op, Observable;







	/**
	 * ====================================
	 * Error Handler Initialisation Methods
	 * ====================================
	 */

	/**
	 * (Constructor) Initialises the module
	 * @param {object} isnode - The parent isnode object
	 */
	var init = function(isnodeObj){
		isnode = isnodeObj, ismod = new isnode.ISMod("ErrorHandler"), ismod.log = log = isnode.module("logger").log;
		lib = isnode.lib, rx = lib.rxjs, op = lib.operators, Observable = rx.Observable;
		var ISPipeline = pipelines.setupErrorHandler();
		new ISPipeline({}).pipe();
		return ismod;
	}






	/**
	 * =====================
	 * Event Stream Pipeline
	 * =====================
	 */


	/**
	 * (Internal > Pipeline [1]) Setup Error Handler
	 */
	pipelines.setupErrorHandler = function(){
		return new isnode.ISNode().extend({
			constructor: function(evt) { this.evt = evt; },
			callback: function(cb) { return cb(this.evt); },
			pipe: function() {
				const self = this; const stream = rx.bindCallback((cb) => {self.callback(cb);})();
				const stream1 = stream.pipe(

					// Fires once on server initialisation:
					op.map(evt => { if(evt) return streamFns.setupErrorHandled(evt); }),
					op.map(evt => { if(evt) return streamFns.setupUncaughtException(evt); }),
					
				);
				stream1.subscribe(function(res) {
					//console.log(res);
				});
			}
		});
	};










	/**
	 * =========================================
	 * Error Handler Stream Processing Functions
	 * (Fires Once on Server Initialisation)
	 * =========================================
	 */

	/**
	 * (Internal > Stream Methods [1]) Setup Error Handled
	 * @param {object} evt - The Request Event
	 */
	streamFns.setupErrorHandled = function(evt){
		ismod.on("errorhandled", function(err){
			if(errorMessages[err] && errorMessages[err] == true){
				errorCount --;
				errorMessages[err] = false;
				delete errorMessages[err];
				return;
			}
		});
		return evt;
	}

	/**
	 * (Internal > Stream Methods [2]) Setup Uncaught Exception
	 * @param {object} evt - The Request Event
	 */
	streamFns.setupUncaughtException = function(evt){
		process.on('uncaughtException', function(err) {
			errorMessages[err.message] = true;
			errorCount ++;
			var counter = 0;
			if(isnode.cfg().errorhandler && isnode.cfg().errorhandler.timeout) { var timeout = isnode.cfg().errorhandler.timeout; } else { var timeout = 5000; }
			ismod.emit("errorthrown", err.message);
			var interval = setInterval(function(){
				if(errorCount <= 0){
					clearInterval(interval);
					log("debug", "Blackrock Error Handler > Thrown exception(s) handled by a listening module or service - " + err.message, err);
					return;
				}
				if(counter >= timeout){
					clearInterval(interval);
					log("fatal", "Blackrock Error Handler > Caught unhandled exception(s). Terminating application server. Error - " + err.message, err);
					isnode.shutdown();
					return;
				}
				counter += 10;
			}, 10);
		});
		return evt;
	}








	/**
	 * (Internal) Export Module
	 */
	module.exports = init;
}();