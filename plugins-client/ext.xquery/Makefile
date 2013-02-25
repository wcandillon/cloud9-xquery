worker : build.js
	node ./r.js -o $<
	$(MAKE) wrap

wrap : xquery-worker-built.js
	./wrap-in-js.sh $<
