$(function () {

    var xhrerror = function (xhr, status, error) {
        console.log(this.name + ": error " + status + ":" + error);
    };

    function getQuery(query) {
        query = query.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");
        var expr = "[\\?&]" + query + "=([^&#]*)";
        var regex = new RegExp(expr);
        var results = regex.exec(window.location.href);
        if (results !== null) {
            return decodeURIComponent(results[1].replace(/\+/g, " "));
        } else {
            return false;
        }
    }

    function hudsonapi(url, success, error) {
        if (!url.match("/$")) {
            url = url + "/";
        }

        $.ajax({
            url:url + "api/json",
            dataType:"jsonp",
            jsonp:"jsonp",
            success:success,
            error:error
        })
    }

    function Job(j, div_pass, div_fail) {
        this.builds = [];
        this.name = j.name;
        this.uri = j.url;

        this.color = j.color;

        this.div_pass = div_pass;
        this.div_fail = div_fail;

        this.wasFailed = undefined;
    }

    Job.prototype.isRunning = function() {
        return this.color.indexOf("anime") != -1 ? true : false;
    };

    Job.prototype.isFailed = function() {
        return this.status() == "failed";
    };

    Job.prototype.status = function() {
        var colorToStatus = {
            red : "failed",
            red_anime : "failed",
            blue: "passed",
            blue_anime : "passed",
            grey : "never-run",
            disabled: "disabled"
        };

        return colorToStatus[this.color];
    };

    function findTestResultsFrom(data) {

        var actions = data.actions;

        for ( var i=  0; i < actions.length; i++ ) {
            if ( "testReport" == actions[i].urlName) {
                return actions[i];
            }
        }

        // can't find any tests, just say there was one test, and it failed if the build failed.

        return {
            failCount: data.result == "FAILURE" ? 1 : 0,
            skipCount : 0,
            totalCount : 1
        }
    }

    Job.prototype.init = function() {
        this.div = ich.testgraph({ name:this.name })[0];
        this.reparent();
        this.reload();
    };

    Job.prototype.reparent = function() {

        var currentlyFailed = this.isFailed();

        if ( currentlyFailed != this.wasFailed ) {
            if ( this.div.parentNode.tagName == "div") {
                $(this.div.parentNode).remove(this.div);
            }

            if ( currentlyFailed ) {
                this.div_fail.append(this.div);
            }
            else {
                this.div_pass.append(this.div);
            }
        }
        this.wasFailed = currentlyFailed;
    };

    Job.prototype.reload = function() {
        console.log("Reloading job");
        this.builds = [];
        this.load();
        var _this = this;
        setTimeout(function() {
            _this.reload();
        }, 10000)
    };

    Job.prototype.load = function () {
        var job = this;
        hudsonapi(
            this.uri,
            function (data) {
                job.color = data.color;
                job.reparent();
                job.updateClasses();
                job.updateBuilds(data);
            },
            xhrerror
        );
    };

    Job.prototype.updateClasses = function() {
        var div = $(this.div);

        div.removeClass();
        div.addClass("graph");
        div.addClass(this.status());

        if ( this.isRunning()) {
            div.addClass("running");
        }
        else {
            div.addClass("waiting");
        }
    };

    Job.prototype.updateBuildResult = function (data) {
        var testresults = findTestResultsFrom(data);
        var buildnumber = data.number;
        var result = data.result;

        this.builds.push({
            buildnumber:buildnumber,
            testresults:testresults,
            result:result
        });

        this.builds.sort(function (a, b) {
            return a.buildnumber - b.buildnumber;
        });

        if ( this.builds.length == this.build_count ) {
            this.renderGraph();
        }
    };

    Job.prototype.renderGraph = function () {

        var skipped = $.map(this.builds, function(e,i) {
            return { x:e.buildnumber, y:e.testresults.skipCount };
        });

        var pass = $.map(this.builds, function(e,i) {
            return { x:e.buildnumber, y:e.testresults.totalCount - ( e.testresults.failCount + e.testresults.skipCount ) };
        });

        var fail = $.map(this.builds, function(e,i) {
            return { x :e.buildnumber, y:e.testresults.failCount};
        });

        $(this.div).children("svg").remove();

        var graph = new Rickshaw.Graph({
            element: this.div,
            renderer:'area',
            stroke:true,
            series:[
                { data:pass, color:'lightgreen' },
                { data:fail, color:'pink' }
            ]
        });

        graph.render();

        var yAxis = new Rickshaw.Graph.Axis.Y( {
            graph: graph,
            tickFormat: Rickshaw.Fixtures.Number.formatKMBT
        } );

        yAxis.render();

        var xAxis = new Rickshaw.Graph.Axis.X( {
            graph: graph
        } );

        xAxis.render();
    };

    Job.prototype.updateBuilds = function (data) {

        var job = this;

        this.buildable = data.buildable;

        var builds = data.builds.splice(0, 10);

        this.build_count = builds.length;

        $.each(builds, function (i, b) {
            hudsonapi(b.url,
                function (data) {
                    job.updateBuildResult(data);
                },
                xhrerror
            );
        });
    };

    function loadJobs(data) {

        var jobs = [];

        var div_fail = $("#graphs-fail");
        var div_pass = $("#graphs-pass");

        $.each(data.jobs, function (i, j) {
            var job = new Job(j, div_pass, div_fail);
            jobs.push(job);
            job.init();
        });

        var failing = $.grep(jobs, function (j) {
            return j.isFailed();
        });

        if (failing.length > 0) {
            $("body").addClass("failed");
            $("#summary").text("-- " + failing.length + " failing");
        }
    }

    function loadJobsInView(hudson, view) {
        hudsonapi(hudson + "/view/" + view, loadJobs, xhrerror);
    }

    var ci = getQuery("ci");
    var view = getQuery("view");

    if ( ! view || ! ci ) {
        alert("use ?ci=<uri of jenkins>&view=<view name>");
    }
    else {
        $("#view").text(view);
        loadJobsInView(ci, view);
    }
});
