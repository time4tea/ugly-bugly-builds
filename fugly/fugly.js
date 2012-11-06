$(function () {

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

    function graphsForJobs(jobs) {
        var colorToStatus = {
            red:"failed",
            red_anime:"failed",
            blue:"passed",
            blue_anime:"passed",
            grey:"never-run",
            disabled:"disabled"
        };

        return $.map(jobs, function (job, index) {
            return {
                name:job.name,
                graphurl:job.url + "/test/trend?width=450&height=180",
                status:colorToStatus[job.color],
                running:job.color.indexOf("anime") != -1 ? "running" : "waiting"
            }
        })
    }

    function showGraphs(data) {
        var graphs = graphsForJobs(data.jobs);

        var passing = $.grep(graphs, function (g) {
            return g.status != "failed"
        });
        var failing = $.grep(graphs, function (g) {
            return g.status == "failed"
        });

        $('#graphs-pass').html(ich.testgraph({graphs:passing}));
        $('#graphs-fail').html(ich.testgraph({graphs:failing}));

        $('.graph img').error(function () {
            $(this).remove();
        });

        if (failing.length > 0) {
            $("body").addClass("failed");
            $("#summary").text("-- " + failing.length + " failing");
        }
    }

    function loadGraphs(hudson, view) {
        $.ajax({
            url:hudson + "/view/" + view + "/api/json",
            dataType:"jsonp",
            jsonp:"jsonp",
            success:showGraphs,
            error:function (xhr, status, error) {
                alert("error " + status + ": " + error);
            }
        });
    }

    var hudson = getQuery("hudson");
    var view = getQuery("view");

    if ( ! view || ! hudson ) {
        alert("use ?hudson=<uri of hudson>&view=<view name>");
    }
    else {
        $("#view").text(view);
        loadGraphs(hudson, view);
    }
});
