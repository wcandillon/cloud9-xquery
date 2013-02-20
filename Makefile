worker : build.js
	node ../r.js -o $<
	$(MAKE) wrap

wrap : cloud9-xquery-worker-built.js
	./wrap-in-js.sh $<
