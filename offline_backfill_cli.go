package main

import (
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

// parseOfflineBackfillCorrection reads ID:FROM_AMOUNT+FROM_BONUS=AMOUNT+BONUS,
// all in whole quota dollars, for example 2039:5900+0=5000+500.
func parseOfflineBackfillCorrection(spec string) (model.OfflineBackfillCorrection, error) {
	invalid := fmt.Errorf("correction %q is not ID:FROM_AMOUNT+FROM_BONUS=AMOUNT+BONUS", spec)
	idText, rest, ok := strings.Cut(spec, ":")
	fromText, toText, ok2 := strings.Cut(rest, "=")
	if !ok || !ok2 {
		return model.OfflineBackfillCorrection{}, invalid
	}
	numbers := make([]int64, 0, 5)
	for _, text := range append([]string{idText}, append(strings.Split(fromText, "+"), strings.Split(toText, "+")...)...) {
		number, err := strconv.ParseInt(text, 10, 64)
		if err != nil {
			return model.OfflineBackfillCorrection{}, invalid
		}
		numbers = append(numbers, number)
	}
	if len(numbers) != 5 {
		return model.OfflineBackfillCorrection{}, invalid
	}
	return model.OfflineBackfillCorrection{Id: int(numbers[0]), FromAmount: numbers[1], FromBonus: numbers[2], Amount: numbers[3], Bonus: numbers[4]}, nil
}

// runOfflineBackfillCorrect is `new-api offline-backfill-correct`: it corrects
// the split between bought and bonus quota of recorded offline backfills (see
// model.CorrectOfflineBackfills). Without -apply it prints the plan and
// changes nothing. It opens the database only, never migrates, and may run
// beside the serving container.
func runOfflineBackfillCorrect(args []string, stdout io.Writer, stderr io.Writer) int {
	flags := flag.NewFlagSet("offline-backfill-correct", flag.ContinueOnError)
	flags.SetOutput(stderr)
	apply := flags.Bool("apply", false, "write the corrections; without it only print them")
	operator := flags.Int("operator", 0, "id of the administrator the audit entry names (required with -apply)")
	reason := flags.String("reason", "", "why the order is corrected (required with -apply)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	var corrections []model.OfflineBackfillCorrection
	for _, spec := range flags.Args() {
		correction, err := parseOfflineBackfillCorrection(spec)
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
		corrections = append(corrections, correction)
	}
	if len(corrections) == 0 {
		fmt.Fprintln(stderr, "usage: new-api offline-backfill-correct [-apply -operator ID -reason TEXT] ID:FROM_AMOUNT+FROM_BONUS=AMOUNT+BONUS ...")
		return 2
	}

	common.InitEnv()
	common.IsMasterNode = false
	logger.SetupLogger()
	if err := model.InitDB(); err != nil {
		fmt.Fprintln(stderr, "database:", err)
		return 1
	}
	defer model.CloseDB()
	if err := model.InitLogDB(); err != nil {
		fmt.Fprintln(stderr, "log database:", err)
		return 1
	}

	results, err := model.CorrectOfflineBackfills(corrections, *apply, *operator, *reason)
	if err != nil {
		fmt.Fprintln(stderr, "nothing was changed:", err)
		return 1
	}
	for i, result := range results {
		state := "already corrected"
		switch {
		case result.Changed && *apply:
			state = "corrected"
		case result.Changed:
			state = "would correct"
		}
		fmt.Fprintf(stdout, "order %d user %d %s money %.2f: amount %d bonus %d -> amount %d bonus %d dollars (%s)\n",
			result.Id, result.UserId, result.TradeNo, result.Money,
			result.Before.Amount, result.Before.Bonus, corrections[i].Amount, corrections[i].Bonus, state)
	}
	return 0
}
