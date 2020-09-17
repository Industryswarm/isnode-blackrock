/*!
* ISNode Blackrock HTTP Interface Module
*
* Copyright (c) 2020 Darren Smith
* Licensed under the LGPL license.
*/

;!function(undefined) {




	/** Initialise Variables & Create String Prototype Method */
	String.prototype.endsWith = function(suffix) {return this.indexOf(suffix, this.length - suffix.length) !== -1;};
	var mustache = require('./support/mustache.js'), formidable = require('./support/formidable');
	var isnode, ismod, log, config, instances = [], client = {}, utils = {}, streamFns = {}, pipelines = {};






	/**
	 * =======================================
	 * HTTP/S Interface Initialisation Methods
	 * =======================================
	 */


	/**
	 * (Constructor) Initialises the module
	 * @param {object} isnode - The parent isnode object
	 */
	var init = function(isnodeObj){
		isnode = isnodeObj, ismod = new isnode.ISInterface("HTTP"), log = isnode.module("logger").log, config = isnode.cfg();
		ismod.client = client;
		ismod.startInterface = startInterface;
		ismod.startInterfaces();
		return ismod;
	}

	/**
	 * (Internal > Init) Attempts to start a defined HTTP interface
	 * @param {string} name - The name of the interface
	 */
	var startInterface = function(name){
		const cfg = config.interfaces.http[name];
		if(cfg.ssl == true) { var protocol = "HTTPS" }
		else { var protocol = "HTTP" }
		log("startup","HTTP Interface Module > Attempting to start " + protocol + " interface (" + name + ") on port " + cfg.port + ".");
		var routers = [];
		for(var routerName in config.router.instances){
			if(config.router.instances[routerName].interfaces && (config.router.instances[routerName].interfaces.includes("*") || config.router.instances[routerName].interfaces.includes(name))) {
				routers.push(isnode.module("router").get(routerName));
			}
		}
		if(routers.length <= 0){ log("startup","HTTP Interface Module > Cannot start " + protocol + " interface (" + name + ") on port " + cfg.port + " as it is not mapped to any routers."); return; }
		var ISPipeline = pipelines.processRequestStream();
		utils.isPortTaken(cfg.port, function(err, result){
			var inst;
			if(result != false){ log("error","HTTP Interface Module > Cannot load HTTP interface (" + name + ") as the defined port (" + cfg.port + ") is already in use."); return; }
			if(cfg.ssl && (!cfg.key || !cfg.cert)){ log("error","HTTP Interface Module > Cannot load SSL interface as either the key or cert has not been defined (" + name + ")."); return; }
			try {
				if(cfg.ssl) { var httpLib = "https" } else { var httpLib = "http" };
				instances[name] = inst = new isnode.ISNode().extend({});
				inst.listening = false;
				var serverLib = require('./support/' + httpLib);
				if(cfg.ssl) { inst.server = serverLib(cfg.key, cfg.cert) } else { inst.server = serverLib() };
				
			} catch (err) {
				log("error","HTTP Interface Module > Error instantiating " + httpLib.toUpperCase() + " interface (" + name + ").",err);
				if(inst) { delete inst; }
				return;
			}
			inst.server.on('request', (request, response) => {
				request.interface = name;
				for (var i = 0; i < routers.length; i++) {
					request.router = routers[i];
					if(protocol == "HTTPS") { request.secure = true; } else { request.secure = false; }
					new ISPipeline({ "req": request, "res": response }).pipe();
				}
			});
			inst.server.listen(cfg.port, function(){
				log("startup","HTTP Interface Module > " + httpLib.toUpperCase() + " Interface (" + name + ") started successfully on port " + cfg.port); inst.listening = true;
			});
			ismod.instances = instances;
		});

	}





	/**
	 * ======================
	 * Event Stream Pipelines
	 * ======================
	 */

	/**
	 * (Internal > Pipelines) Processes the Incoming Request Stream [HTTP/S]
	 */
	pipelines.processRequestStream = function(){
		const lib = isnode.lib, rx = lib.rxjs, op = lib.operators;
		const ISPipeline = new isnode.ISNode().extend({
			constructor: function(evt) { this.evt = evt; },
			callback: function(cb) { return cb(this.evt); },
			pipe: function() {
				const self = this; const stream = rx.bindCallback((cb) => {self.callback(cb);})();
				const stream1 = stream.pipe(
					op.map(evt => { if(evt) return streamFns.checkErrors(evt); }),
					op.map(evt => { if(evt) return streamFns.determineContentType(evt); }),
					op.map(evt => { 
						if(evt && evt.req.multipart) { 
							return streamFns.parseMultiPart(evt); 
						} else if (evt && !evt.req.multipart) { 
							return streamFns.parseNonMultiPart(evt); 
						} 
					})
				).toPromise();
				const stream2 = rx.from(stream1).pipe(
					op.map(evt => { if(evt) return streamFns.processRequestData(evt); }),
					op.map(evt => { if(evt) return streamFns.parseCookies(evt); }),
					op.map(evt => { if(evt) return streamFns.processHostPathAndQuery(evt); }),
					op.map(evt => { if(evt) return streamFns.fetchIPAddresses(evt); }),
					op.map(evt => { if(evt) return streamFns.isRequestSecure(evt); }),
					op.map(evt => { if(evt) return streamFns.prepareRequestMessage(evt); }),
					op.map(evt => { if(evt) return streamFns.fixTrailingSlash(evt); }),
					op.map(evt => { if(evt) return streamFns.lookupRequestRoute(evt); }),
					op.map(evt => { if(evt) return streamFns.pipeFilesystemFiles(evt); }),
					op.map(evt => { if(evt) return streamFns.routeRequest(evt); })
				);
				stream2.subscribe(function(res) {
					//console.log(res);
				});
			}
		});
		return ISPipeline;
	};

	/**
	 * (Internal > Pipelines) Processes the Outgoing Response Stream [HTTP/S]
	 */
	pipelines.processResponseStream = function(){
		const lib = isnode.lib, rx = lib.rxjs, op = lib.operators;
		const ISPipeline = new isnode.ISNode().extend({
			constructor: function(evt) { this.evt = evt; },
			callback: function(cb) { return cb(this.evt); },
			pipe: function() {
				const self = this; const stream = rx.bindCallback((cb) => {self.callback(cb);})();
				const stream1 = stream.pipe(
					op.map(evt => { if(evt) return streamFns.preventDuplicateResponses(evt); }),
					op.map(evt => { if(evt) return streamFns.setStatusCookiesAndHeaders(evt); }),
					op.map(evt => { if(evt) return streamFns.checkAndFinaliseLocationRequest(evt); }),
					op.map(evt => { if(evt) return streamFns.checkAndFinaliseResponseWithoutView(evt); }),
					op.map(evt => { if(evt) return streamFns.checkAndFinaliseFileResponse(evt); }),
					op.map(evt => { if(evt) return streamFns.checkAndSetMIMEType(evt); }),
					op.map(evt => { if(evt) return streamFns.detectViewType(evt); }),
					op.map(evt => { 
						if(evt && evt.msg.viewType == "object") { 
							return streamFns.processObjectViewResponse(evt); 
						} else if (evt && evt.msg.viewType != "object") { 
							return streamFns.processFileViewResponse(evt); 
						}  
					})
				).toPromise();
				const stream2 = rx.from(stream1).pipe(
					op.map(evt => { if(evt) return streamFns.afterResPromise(evt); })
				);
				stream2.subscribe(function(res) {
					//console.log(res);
				});
			}
		});
		return ISPipeline;
	};





	/**
	 * =================================
	 * Request Stream Processing Methods
	 * =================================
	 */

	/**
	 * (Internal > Stream Methods [1]) Check HTTP Request For Errors
	 * @param {object} evt - The Request Event
	 */
	streamFns.checkErrors = function(evt) {
		evt.res.resReturned = false;
	    evt.req.on('error', (err) => { log("error","HTTP Interface > Error processing incoming request", err); evt.res.statusCode = 400; evt.res.end(); evt.res.resReturned = true; });
	    evt.res.on('error', (err) => { log("error","HTTP Interface > Error processing outgoing response", err); });
	    return evt;
	}

	/**
	 * (Internal > Stream Methods [2]) Determine Content-Type of Request Message
	 * @param {object} evt - The Request Event
	 */
	streamFns.determineContentType = function(evt) {
	    const {method, url, headers} = evt.req;
	    for(var header in headers){ header = header.toLowerCase(); if(header == "content-type") { var contentType = headers[header]; } }
	    var contentTypes = {};
	    if(contentType){
	    	contentType = contentType.split(";");
	    	for (var i = 0; i < contentType.length; i++) {
	    		contentType[i] = contentType[i].trim();
	    		if(contentType[i] == "multipart/form-data") { var multipart = true; }
	    		if(contentType[i].startsWith("boundary=")){ var boundary = contentType[i].split("="); boundary = boundary[1]; }
	    	}
	    }
	    if(!boundary) { var boundary = "" }; if(multipart) { evt.req.multipart = true; } else { evt.req.multipart = false; }; return evt;
	}

	/**
	 * (Internal > Stream Methods [3a]) Parses a multi-part http message
	 * @param {object} evt - The Request Event
	 */
	streamFns.parseMultiPart = function(evt) {
  		return new Promise((resolve, reject) => {
			var form = new formidable.IncomingForm();
			if(config.interfaces.http[req.interface].fileUploadPath) { form.uploadDir = config.interfaces.http[req.interface].fileUploadPath; }
			else { form.uploadDir = "./tmp/"; }
			if(config.interfaces.http[req.interface].maxUploadFileSizeMb) { form.maxFileSize = config.interfaces.http[req.interface].maxUploadFileSizeMb * 1024 * 1024; }
			else { form.maxFileSize = 50 * 1024 * 1024; }
			try { form.parse(req, function(err, fields, files) { var body = fields; body.files = files; body.error = err; evt.data = body; resolve(evt); }); }
			catch (err) { evt.data = {error: "File Upload Size Was Too Large"}; resolve(evt); }
		});
	}

	/**
	 * (Internal > Stream Methods [3b]) Parses a non-multi-part http message
	 * @param {object} evt - The Request Event
	 */
	streamFns.parseNonMultiPart = function(evt) {
		return new Promise((resolve, reject) => {
		    let data = []; 
		    evt.req.on('data', (chunk) => { 
		    	data.push(chunk); 
		    }).on('end', () => { 
		    	evt.data = data; 
		    	resolve(evt); 
		    });
	    });
	}

	/**
	 * (Internal > Stream Methods [4]) Process Request Data
	 * @param {object} evt - The Request Event
	 */
	streamFns.processRequestData = function(evt) {
	 	var data = evt.data;
		try { if(Buffer.from(data)) { data = Buffer.concat(data).toString(); } } catch(err){ null; }
        if(data && isnode.module("utilities").isJSON(data) == "json_string"){ data = JSON.parse(data); }
        else if (data && isnode.module("utilities").isJSON(data) == "json_object") { data = data; }
        else if (data) { data = require('querystring').parse(data); }
        evt.data = data;
		return evt;
	}

	/**
	 * (Internal > Stream Methods [5]) Parses Cookies From Headers
	 * @param {object} evt - The Request Event
	 */
	streamFns.parseCookies = function(evt) {
	    var list = {}, rc = evt.req.headers.cookie;
	    rc && rc.split(';').forEach(function( cookie ) {
	        var parts = cookie.split('=');
	        list[parts.shift().trim()] = decodeURI(parts.join('='));
	    });
	    evt.req.cookieObject = list;
	    return evt;
	}

	/**
	 * (Internal > Stream Methods [6]) Parse Host, Path & Query From URL
	 * @param {object} evt - The Request Event
	 */
	streamFns.processHostPathAndQuery = function(evt) {
		var url = evt.req.url, headers = evt.req.headers, path = url, splitPath = path.split("?");
		evt.req.queryStringObject = {};
		if(splitPath[1]){
			var splitQuery = splitPath[1].split("&");
			for (var i = 0; i < splitQuery.length; i++) {
				var moreSplitQuery = splitQuery[i].split("=");
				if(!evt.req.queryStringObject[moreSplitQuery[0]]) { evt.req.queryStringObject[moreSplitQuery[0]] = moreSplitQuery[1]; }
				else {
					var oldValue = evt.req.queryStringObject[moreSplitQuery[0]];
					evt.req.queryStringObject[moreSplitQuery[0]] = [];
					evt.req.queryStringObject[moreSplitQuery[0]].push(oldValue);
					evt.req.queryStringObject[moreSplitQuery[0]].push(moreSplitQuery[1]);
				}
			}
		}
		var splitHost = headers.host.split(":"), host = splitHost[0], port = splitHost[1];
		evt.req.theHost = host;
		evt.req.thePort = port;
		evt.req.thePath = splitPath[0];
		return evt;
	}

	/**
	 * (Internal > Stream Methods [7]) Parse IP Addresses
	 * @param {object} evt - The Request Event
	 */
	streamFns.fetchIPAddresses = function(evt) {
	 	const {method, url, headers, connection} = evt.req; var reqIpAddressV6 = "";
		if(headers["X-Forwarded-For"]) { var reqIpAddress = headers["X-Forwarded-For"]; }
		else if (connection.remoteAddress) { var reqIpAddress = connection.remoteAddress; }
		else { var reqIpAddress = ""; }
		if (reqIpAddress.indexOf(':') > -1) {
			var startPos = reqIpAddress.lastIndexOf(':'), endPos = reqIpAddress.length;
			var ipv4 = reqIpAddress.slice(startPos + 1, endPos), ipv6 = reqIpAddress.slice(0, startPos - 1);
			evt.req.reqIpAddress = ipv4; evt.req.reqIpAddressV6 = ipv6;
		}
		return evt;
	}

	/**
	 * (Internal > Stream Methods [8]) Parse Whether Request is Secure
	 * @param {object} evt - The Request Event
	 */
	streamFns.isRequestSecure = function(evt) {
	 	const {headers} = evt.req, request = evt.req;
		if(headers["X-Forwarded-Proto"] && headers["X-Forwarded-Proto"] == "http") { evt.req.reqSecure = false; }
		else if(headers["X-Forwarded-Proto"] && headers["X-Forwarded-Proto"] == "https") { evt.req.reqSecure = true; }
		else { evt.req.reqSecure = request.secure; }
		return evt;
	}

	/**
	 * (Internal > Stream Methods [9]) Prepare Request Message
	 * @param {object} evt - The Request Event
	 */
	streamFns.prepareRequestMessage = function(evt) {
		var request = evt.req, msgId = isnode.module("utilities").uuid4(), {method, url, headers} = request;
		evt.req.theMessage = {
			"type": "http", "interface": request.interface, "msgId": msgId, "state": "incoming", "directional": "request/response",
			"request": {
				"path": evt.req.thePath, "host": evt.req.theHost, "port": evt.req.thePort, "query": evt.req.queryStringObject, 
				"headers": request.headers, "params": null, "cookies": evt.req.cookieObject,
				"ip": evt.req.reqIpAddress, "ipv6": evt.req.reqIpAddressV6, "verb": method, "secure": evt.req.reqSecure, "body": evt.data,
			}
		}
		return evt;
	}

	/**
	 * (Internal > Stream Methods [10]) Fix Trailing Slash
	 * @param {object} evt - The Request Event
	 */
	streamFns.fixTrailingSlash = function(evt) {
	 	const {method, url, headers, connection, theMessage} = evt.req, response = evt.res;
		if(theMessage.request.path.endsWith("/") && theMessage.request.path != "/"){
			evt.res.resReturned = true;
			var newPath = theMessage.request.path.slice(0, -1);
			response.writeHead(301, {Location: newPath});
			response.end();
			return;
		} else if (theMessage.request.path == "") {
			evt.res.resReturned = true;
			response.writeHead(301, {Location: "/"});
			response.end();
			return;
		}
		return evt;
	}

	/**
	 * (Internal > Stream Methods [11]) Lookup Request Route
	 * @param {object} evt - The Request Event
	 */
	streamFns.lookupRequestRoute = function(evt) {
		const request = evt.req, {theMessage} = request;
		var route = request.router.route(theMessage.request.host, theMessage.request.path);
		if(route && route.match && route.match.service){
			var basePath = isnode.module("services").service(route.match.service).cfg().basePath;
			if(theMessage.request.path == basePath) { theMessage.request.path += "/"; }
		}
		theMessage.request.params = route.param;
		if(route && route.match && route.match.service){
			var srv = isnode.module("services").service(route.match.service);
			if(srv.cfg().basePath) { var base = srv.cfg().basePath; }
			else { var base = ""; }
			if(theMessage.request.path.startsWith(base)){ var htmlPath = theMessage.request.path.slice(base.length); }
			else { var htmlPath = theMessage.request.path; }
		} else { var htmlPath = theMessage.request.path; }
		evt.req.route = route;
		evt.req.htmlPath = htmlPath;
		return evt;
	}

	/**
	 * (Internal > Stream Methods [12]) Pipe (HTML) Filesystem Files
	 * @param {object} evt - The Request Event
	 */
	streamFns.pipeFilesystemFiles = function(evt) {
		var fs = require('fs'), os = require("os"), request = evt.req, response = evt.res, resReturned = false, {method, url, headers, route, htmlPath, theMessage} = request, rootBasePath = __dirname + "/../../../../";
		var msg = request.theMessage;
		try { var stats = fs.lstatSync(rootBasePath + "services/" + route.match.service + "/html" + htmlPath); var directPath = true; } 
		catch(e) { var stats = false; }
		if(!stats || stats.isDirectory()){
			try { var stats = fs.lstatSync(rootBasePath + "services/" + route.match.service + "/html" + htmlPath + "/index.html"); var directPath = false; } 
			catch(e) { var stats = false; }
		}
		if(stats && stats.isFile()){
			if(directPath == true){ var pathToRead = rootBasePath + "services/" + route.match.service + "/html/" + htmlPath; }
			else { var pathToRead = rootBasePath + "services/" + route.match.service+"/html/" + htmlPath + "/index.html"; }
			log("debug","HTTP Interface > File " + theMessage.request.path + " found and returned to interface for message " + theMessage.msgId, theMessage);
			var filename = theMessage.request.path.split("/"), mimeType = utils.checkMIMEType(filename[filename.length - 1].split('.').pop());
			if (!mimeType) { mimeType = 'application/octet-stream'; }
			response.writeHead(200, { "Content-Type": mimeType });
			fs.createReadStream(pathToRead).pipe(response);
			evt.res.resReturned = true;
			return evt;
		} else {
			return evt;
		}
	}

	/**
	 * (Internal > Stream Methods [13]) Route Request via Router
	 * @param {object} evt - The Request Event
	 */
	streamFns.routeRequest = function(evt) {
		const request = evt.req, ISResPipeline = pipelines.processResponseStream();
		var resReturned = false;
		var responseListener = function(msg){ 
			instances[request.interface].removeListener('outgoing.' + msg.msgId, responseListener);
			resReturned = true;
			new ISResPipeline({"req": evt.req, "res": evt.res, "msg": msg}).pipe(); 
		}
		instances[request.interface].on('outgoing.' + request.theMessage.msgId, responseListener);
		var timeout = config.interfaces.http[request.interface].requestTimeout, timer = 0;
		var interval = setInterval(function(){
			if(!resReturned && timer < timeout){
				timer += 500;
			} else if (!resReturned && timer >= timeout) {
				evt.res.statusCode = 504;
				evt.res.setHeader('Content-Type', 'application/json');
				evt.res.end(JSON.stringify({"error":"Request timed out"}));
				resReturned = true;
				clearInterval(interval);
				instances[request.interface].removeListener('outgoing.' + evt.req.theMessage.msgId, responseListener);
			} else if (resReturned) {
				clearInterval(interval);
			}
		}, 500);
		log("debug","HTTP Interface > Routing incoming message " + request.theMessage.msgId, request.theMessage);
		request.router.incoming(request.theMessage);
		return evt;
	}











	/**
	 * =================================
	 * Response Stream Processing Methods
	 * =================================
	 */

	/**
	 * (Internal > Response Stream Methods [1]) Prevent Duplicate Responses
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.preventDuplicateResponses = function(evt) {
 		if(!evt.msg.interface) { return; }; if(evt.res.resReturned) { return; }
		log("debug","HTTP Interface > Received response " + evt.msg.msgId + " from router", evt.msg);
		evt.res.resReturned = true;
		return evt;
	}

	/**
	 * (Internal > Response Stream Methods [2]) Set Status Code, Cookies & Headers
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.setStatusCookiesAndHeaders = function(evt) {
		evt.res.statusCode = evt.msg.response.statusCode;
		if(evt.msg.response.cookies){
			for (var name in evt.msg.response.cookies) {
				evt.res.setHeader('Set-Cookie', name + "=" + evt.msg.response.cookies[name].value + "; path=/;");
			}
		}
		if(evt.msg.response.clearCookies){
			for (var name in evt.msg.response.clearCookies) {
				evt.res.setHeader('Set-Cookie', name + '=deleted; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT');
			}
		}
		if(evt.msg.response.headers && typeof evt.msg.response.headers === 'object' && evt.msg.response.headers !== null){
			for (var header in evt.msg.response.headers) {
				evt.res.setHeader(header, evt.msg.response.headers[header]);
			}
		}
		return evt;
	}

	/**
	 * (Internal > Response Stream Methods [3]) Check & Finalise Location Request
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.checkAndFinaliseLocationRequest = function(evt) {
		if(evt.msg.response.location){
			evt.res.setHeader('Location', evt.msg.response.location);
			evt.res.end();
			return;
		} else {
			return evt;
		}
	}

	/**
	 * (Internal > Response Stream Methods [4]) Check & Finalise JSON Response Without View
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.checkAndFinaliseResponseWithoutView = function(evt) {
		if(!evt.msg.response.view && evt.msg.response.body){
			evt.res.setHeader('Content-Type', 'application/json');
			evt.res.end(JSON.stringify(evt.msg.response.body));
			return;
		} else {
			return evt;
		}
	}

	/**
	 * (Internal > Response Stream Methods [5]) Check & Finalise File Response
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.checkAndFinaliseFileResponse = function(evt) {
		if (evt.msg.response.file) {
			var fs = require('fs');
			try { var stats = fs.lstatSync(evt.msg.response.file); }
			catch(e) { var stats = false; }
			if(stats && stats.isFile()){
				var pathToRead = evt.msg.response.file;
				log("debug","HTTP Interface > Sending File " + pathToRead + " to client. " + evt.msg.msgId, evt.msg);
				var filename = pathToRead.split("/");
				var mimeType = utils.checkMIMEType(filename[filename.length - 1].split('.').pop());
				if (!mimeType) { mimeType = 'application/octet-stream'; }
				evt.res.writeHead(200, { "Content-Type": mimeType });
				var stream = fs.createReadStream(pathToRead), had_error = false;
				stream.pipe(evt.res);
				stream.on('error', function(err){ had_error = true; if(evt.msg.response.cb) { evt.msg.response.cb(err, null); } });
				stream.on('close', function(){
					if (!had_error && evt.msg.response.cb) {
						evt.msg.response.cb(null, { success: true, code: "FILE_DOWNLOADED", message: "File Successfully Downloaded"});
					}
				});
				return;
			} else {
				evt.res.setHeader('Content-Type', 'application/json');
				evt.res.end(JSON.stringify({error: "Cannot Find File"}));
				return;
			}
		} else {
			return evt;
		}
	}

	/**
	 * (Internal > Response Stream Methods [6]) Check & Set MIME Type
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.checkAndSetMIMEType = function(evt) {
		var urlSplit = evt.req.url.split("/");
		var filename = urlSplit[urlSplit.length - 1];
		var fileType = filename.split(".")[1];
		var mimeType = utils.checkMIMEType(fileType);
		if (!mimeType) { mimeType = 'text/html'; }
		evt.res.setHeader('Content-Type', mimeType);
		return evt;
	}

	/**
	 * (Internal > Response Stream Methods [7]) Detect View Type
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.detectViewType = function(evt) {
		if(typeof evt.msg.response.view === 'object' && evt.msg.response.view !== null)
			evt.msg.viewType = "object";
		else
			evt.msg.viewType = "file";
		return evt;
	}

	/**
	 * (Internal > Response Stream Methods [8]) Process Object View Response
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.processObjectViewResponse = function(evt) {
		return new Promise((resolve, reject) => {
			var basePath = __dirname + "/../../../../", fs = require('fs');
			if(typeof evt.msg.response.view === 'object' && evt.msg.response.view !== null) {
				if(evt.msg.response.view.file) {
					try {
						fs.readFile(basePath + "services/" + evt.msg.service + "/views/" + evt.msg.response.view.file, "utf8", function (err, htmlData) {
						    if (err) {
								log("error","HTTP Server Interface > " + basePath + "services/" + evt.msg.service + "/views/" + evt.msg.response.view.file + " view does not exist.", evt.msg);
								evt.res.setHeader('Content-Type', 'application/json');
								evt.res.end(JSON.stringify(evt.msg.response.body));	
								return;							    	
						    }       
						    renderView(evt.msg, evt.res, mustache, htmlData);
						    return;
						});
					} catch(err){
						log("error","HTTP Interface > "+evt.msg.response.view+" view does not exist.", evt.msg);
						evt.res.setHeader('Content-Type', 'application/json');
						evt.res.end(JSON.stringify(evt.msg.response.body));	
						return;	
					}
				} else if (evt.msg.response.view.html) {
					var htmlData = evt.msg.response.view.html;
					utils.renderView(evt.msg, evt.res, mustache, htmlData);
					return;
				} else {
					log("error","HTTP Interface > Error loading view - unknown type.", evt.msg);
					evt.res.setHeader('Content-Type', 'application/json');
					evt.res.end(JSON.stringify(evt.msg.response.body));
					return;	
				}
			} else {
				resolve(evt);
			}
		});
	}

	/**
	 * (Internal > Response Stream Methods [9]) Process File View Response
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.processFileViewResponse = function(evt) {
		return new Promise((resolve, reject) => {
			var basePath = __dirname + "/../../../../", fs = require('fs');
			try {
				fs.readFile(basePath + "services/" + evt.msg.service + "/views/" + evt.msg.response.view, "utf8", function (err, htmlData) {
				    if (err) {
						log("error","HTTP Server Interface > " + basePath + "services/" + evt.msg.service + "/views/" + evt.msg.response.view + " view does not exist.", evt.msg);
						evt.res.setHeader('Content-Type', 'application/json');
						evt.res.end(JSON.stringify(evt.msg.response.body));	
						return;							    	
				    }       
				    utils.renderView(evt.msg, evt.res, mustache, htmlData);
				    return;
				});
			} catch(err){
				log("error","HTTP Interface > " + evt.msg.response.view + " view does not exist...", evt.msg);
				evt.res.setHeader('Content-Type', 'application/json');
				evt.res.end(JSON.stringify(evt.msg.response.body));
			}
			resolve(evt);
		});
	}

	/**
	 * (Internal > Response Stream Methods [10]) After Response Promise Method
	 * @param {object} evt - Response Message From Router (Not Same As Request Event)
	*/
	streamFns.afterResPromise = function(evt) {
		return evt;
	}










	/**
	 * ===============
	 * Utility Methods
	 * ===============
	 */


	/**
	 * (Internal > Utilities) Render View
	 * @param {object} msg - Message Object
	 * @param {object} response - Response Object
	 * @param {object} mustache - Mustache Library
	 * @param {string} htmlData - HTML Data Context
	 */
	utils.renderView = function(msg, response, mustache, htmlData) {
		var rootBasePath = __dirname + "/../../../../", fs = require("fs"), partials = {}, regex = /{{>(.+)}}+/g, found = htmlData.match(regex);
		if(found){
			for (var i = 0; i < found.length; i++) {
				var frontRemoved = found[i].substring(4).slice(0, -2);
				try { partials[frontRemoved] = fs.readFileSync(rootBasePath + "services/" + msg.service + "/views/includes/" + frontRemoved + ".mustache", "utf8"); }
				catch(err){ null; }
			}
		}
		var output = mustache.render(htmlData, msg.response.body, partials);
		response.end(output);	
	}

	/**
	 * (Internal > Utilities) Checks if a port is already taken or in use
	 * @param {integer} port - The port number to check
	 * @param {function} cb - Callback function
	 */
	utils.isPortTaken = function(port, cb) {
	  var tester = require('net').createServer()
	  	.once('error', function (err) { if (err.code != 'EADDRINUSE') { return cb(err); }; cb(null, true); })
	  	.once('listening', function() { tester.once('close', function() { cb(null, false) }).close(); })
	  	.listen(port)
	}

	/**
	 * (Internal > Utilities) Check MIME Type Based On File Type
	 * @param {string} fileType - File Type
	 */
	utils.checkMIMEType = function(fileType) {
		var mimeTypes = {
			"jpeg": "image/jpeg", "jpg": "image/jpeg", "png": "image/png", "gif": "image/gif",
			"html": "text/html", "js": "text/javascript", "css": "text/css", "csv": "text/csv",
			"pdf": "application/pdf", "md": "text/plain", "txt": "text/plain"
		};
		return mimeTypes[fileType];
	}











	/**
	 * ===================
	 * HTTP Client Library
	 * ===================
	 */


	/**
	 * (External > Client Library) Makes an HTTP Request
	 * @param {string} req - Request Object. Example:
	 * {
	 *   "url": "https://www.google.com:8080/path1/path2?test=now",
	 *   "headers": {
	 *		"Content-Type": "application/json",
	 *      "Content-Length": data.length
	 *   },
	 *   "method": "POST",
	 *   "data": {"test": "value"},
	 *   "encoding": "utf8"
	 * }
	 * @param {function} cb - Callback Function
	 */
	client.request = function(req, cb) {

		if(!req.url) { cb({ success: false, code: 1, message: "URL Not Defined"}, null); return; }
		if(!req.method) { cb({ success: false, code: 2, message: "Method Not Defined"}, null); return; }
		if(req.url.split("/") == "http:") { var protocol = "http"; }
		else if (req.url.split("/") == "https:") { var protocol = "https"; } 
		else { cb({ success: false, code: 3, message: "Unknown Protocol"}, null); return; }
		var httpLib = require(protocol), hostname = urlPieces[2].split(":")[0];
		if(domainPieces[1]) { var port = domainPieces[1]; }
		urlPieces.shift(); urlPieces.shift(); urlPieces.shift();
		var path = "/" + urlPieces.join("/").split("?")[0], options = { "hostname": hostname, "method": req.method }

		if(port) { options.port = port; }
		if(req.headers) { options.headers = req.headers; } else { options.headers = {}; }
		if(path) { options.path = path; }

		if (req.data && isnode.module("utilities").isJSON(req.data) == "json_object") {
			if(!options.headers["Content-Type"]) { options.headers["Content-Type"] = "application/json"; }; req.data = JSON.stringify(req.data);
		} else if (req.data && (typeof req.data === 'string' || req.data instanceof String) && isnode.module("utilities").isJSON(req.data) == "json_string") {
			if(!options.headers["Content-Type"]) { options.headers["Content-Type"] = "application/json"; }
		} else if (req.data && (typeof req.data === 'string' || req.data instanceof String) && req.data.indexOf('<') !== -1 && req.data.indexOf('>') !== -1) {
			if(!options.headers["Content-Type"]) { options.headers["Content-Type"] = "application/xml"; }
		} else if (req.data && (typeof req.data === 'string' || req.data instanceof String)) {
			if(!options.headers["Content-Type"]) { options.headers["Content-Type"] = "text/plain"; }
		} else {
			if(!options.headers["Content-Type"]) { options.headers["Content-Type"] = "text/plain"; }
		}

		if(req.data && !options.headers["Content-Length"]) { options.headers["Content-Length"] = Buffer.byteLength(req.data); }

		var reqObj = httpLib.request(options, function (res) {
		  let responseData = "";
		  if(req.encoding) { res.setEncoding(req.encoding) }
		  else { res.setEncoding("utf8"); }
		  res.on('data', (chunk) => { responseData += chunk; });
		  res.on('end', () => {
		  	if (responseData && isnode.module("utilities").isJSON(responseData) == "json_string") { responseData = JSON.parse(responseData); }
		    else if (responseData && responseData.indexOf('<') == -1 && responseData.indexOf('>') == -1 && responseData.indexOf('=') !== -1) {
		    	var responseDataSplit = responseData.split("&"), responseDataNew = {};
		    	for (var i = 0; i < responseDataSplit.length; i++) {
		    		var valueSplit = responseDataSplit[i].split("=");
		    		responseDataNew[decodeURIComponent(valueSplit[0])] = decodeURIComponent(valueSplit[1]);
		    	}
		    	responseData = responseDataNew;
		    } else { responseData = decodeURIComponent(responseData); }
		    cb(null, { success: true, code: 4, message: "Response Received Successfully", statusCode: res.statusCode, data: responseData });
		    return;
		  });
		});
		reqObj.on('error', (error) => { cb({ success: false, code: 5, message: "Request Error", error: error}, null); });
		if(req.data) { reqObj.write(req.data); }
		reqObj.end();
	}

	/**
	 * (External > Client Library) Makes a GET HTTP Request
	 * @param {string} url - Request URL
	 * @param {function} cb - Callback Function
	 */
	client.get = function(url, cb) { 
		ismod.client.request({ "url": url, "headers": {}, "method": "GET", "encoding": "utf8" }, cb); 
	}

	/**
	 * (External > Client Library) Makes a POST HTTP Request
	 * @param {string} url - Request URL
	 * @param {function} cb - Callback Function
	 */
	client.post = function(url, data, options, cb) {
		var reqObj = { "url": url, "headers": {}, "method": "POST", "encoding": "utf8" };
		if(data) { reqObj.data = data; }
		if(options && options.headers) { reqObj.headers = options.headers; }
		ismod.client.request(reqObj, cb);
	}

	/**
	 * (External > Client Library) Makes a PUT HTTP Request
	 * @param {string} url - Request URL
	 * @param {function} cb - Callback Function
	 */
	client.put = function(url, data, options, cb) {
		var reqObj = { "url": url, "headers": {}, "method": "PUT", "encoding": "utf8" };
		if(data) { reqObj.data = data; }
		if(options && options.headers) { reqObj.headers = options.headers; }
		ismod.client.request(reqObj, cb);
	}

	/**
	 * (External > Client Library) Makes a DELETE HTTP Request
	 * @param {string} url - Request URL
	 * @param {function} cb - Callback Function
	 */
	client.delete = function(url, data, options, cb) {
		var reqObj = { "url": url, "headers": {}, "method": "DELETE", "encoding": "utf8" };
		if(data) { reqObj.data = data; }
		if(options && options.headers) { reqObj.headers = options.headers; }
		ismod.client.request(reqObj, cb);
	}

	/**
	 * (Internal) Export Module
	 */
	module.exports = init;
}();