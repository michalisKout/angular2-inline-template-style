'use strict';

var fs = require('fs');
var path = require('path');
var minify = require('html-minifier').minify;
var CleanCSS = require('clean-css');
var less = require('less');
var sass = require('node-sass');

module.exports = function (content, options, targetDir) {
	options = options || {};
	options.base = options.base || './';

	if(options.parseOnlyTemplate) {
		return processTemplateUrl(content, options, targetDir);
	}

	return processStyleUrls(content, options, targetDir).then((r) => processTemplateUrl(r, options, targetDir));
};

function processStyleUrls(content, options, targetDir) {
	let closure = content;
	let re = /([/*]*|[/*]+\s*)styleUrls\s*:\s*(\[[^](.[^]*?)\])/g;
	let matches = closure.match(re);

	if (matches === null || matches.length <= 0) {
		return Promise.resolve(closure);
	}

	return Promise.all(matches.map(function () {
		let exec = re.exec(closure);
		let style = exec[0];
		let urls = exec[2];
		urls = urls.replace(/'/g, '"');
		urls = JSON.parse(urls);

		if (exec[1].trim() !== '') {
			return '';
		}

		return Promise.all(urls.map(function (url) {
			const filePath = getAbsoluteUrl(url, options, targetDir);
			let file = fs.readFileSync(filePath, 'utf-8');

			let fileNamePartsRe = /^[\./]*([^]*)\.(css|less|scss)$/g;
			let fileNamePartsMatches = url.match(fileNamePartsRe);
			if (fileNamePartsMatches === null || fileNamePartsMatches.length <= 0) {
				// Unsupported file type / malformed url
				return file;
			}

			let fileNamePartsExec = fileNamePartsRe.exec(url);
			let fileName = fileNamePartsExec[1];
			let extension = fileNamePartsExec[2];
			let promise;
			if (extension === 'scss') {
				promise = new Promise((resolve) => {
					resolve(sass.renderSync({
						file: filePath,
						includePaths: options.includePaths ? options.includePaths : []
					}).css.toString());
				}).then((output) => {
					return output;
				}, (e) => {
					throw e;
				});
			} else if (extension === 'less') {
				promise = less.render(
					file,
					{
						paths: [options.base ? options.base : '.'],
						filename: targetDir ? path.join(targetDir, fileName) : fileName,
						compress: options.compress
					}
				).then((output) => {
					return output.css;
				}, (e) => {
					throw e;
				});
			} else {
				promise = Promise.resolve(file);
			}

			return promise.then((processed) => {
				if (options.compress) {
					processed = new CleanCSS().minify(processed).styles;
				} else {
					processed = processed.replace(/[\r\n]/g, '');
				}

				// escape \ char
				processed = processed.replace(new RegExp('\\\\', 'g'), '\\\\');

				// escape quote chars
				processed = processed.replace(new RegExp('\'', 'g'), '\\\'');
				return processed;
			});
		})).then((files) => {
			closure = closure.replace(style, 'styles: [\'' + files.join('') + '\']');
		});
	})).then(() => {
		return closure;
	});
}

function processTemplateUrl(content, options, targetDir) {
	let closure = content;
	let re = /([/*]*|[/*]+\s*)templateUrl\s*:\s*(?:"([^"]+)"|'([^']+)')/g;
	let newLine = /[\r\n]+/g;
	let matches = closure.match(re);
	let htmlMinifyConfig = {
		caseSensitive: true,
		collapseWhitespace: true,
		/*
		ng2 bindings break the parser for html-minifer, so the
		following blocks the processing of ()="" and []="" attributes
		*/
		ignoreCustomFragments: [/\s\[.*\]=\"[^\"]*\"/, /\s\([^)"]+\)=\"[^\"]*\"/]
	};

	if (matches === null || matches.length <= 0) {
		return Promise.resolve(closure);
	}

	matches.forEach(function () {
		let exec = re.exec(closure);
		let template = exec[0];
		let quote;
		let url;
		if (exec[1].trim() === '') {
			if (exec[2]) {
				url = exec[2];
				quote = '"';
			} else {
				url = exec[3];
				quote = '\'';
			}

			let file = fs.readFileSync(getAbsoluteUrl(url, options, targetDir), 'utf-8');
			if (options.compress) {
				file = minify(file, Object.assign({}, htmlMinifyConfig, {removeComments: true}));
			} else {
				file = minify(file, htmlMinifyConfig);
			}

			// escape quote chars
			file = file.replace(new RegExp(quote, 'g'), '\\' + quote);

			// join multilines
			file = file.split(newLine).join(quote + ' +\n' + quote);

			closure = closure.replace(template, 'template: ' + quote + file + quote);
		}
	});

	return Promise.resolve(closure);
}

function getAbsoluteUrl(url, options, targetDir) {
	return options.relative ? path.join(targetDir, url) : path.join(options.base, url);
}
